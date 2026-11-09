/**
 * Main-process project backup snapshots.
 *
 * A snapshot is a timestamped zip of the whole project folder (minus caches and
 * staged deletes), so a writer can back up before a reorganisation or an update
 * and get back to a known-good copy. A restore always extracts into a *new*
 * folder and is never written over the live project. Automatic snapshots (taken
 * before a storage migration on project open) are kept to a bounded count and
 * hold only the text files a migration can rewrite (see `isMigrationDataFile`).
 *
 * Zips are streamed (yazl / yauzl) one file at a time: projects can hold gigabytes
 * of images, and building the archive in memory froze the main process (and with
 * it the whole app) while it ran out of RAM.
 *
 * Dependencies (fs, path, the clock) are injected so unit tests can run against a
 * real temp tree while keeping timestamps deterministic.
 */

const nodeFs = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');

/** Staged deletes (see trash-manager) and our own state are never backed up. */
const EXCLUDED_DIRS = new Set(['.ensemble-trash', '.ensemble-backup', 'node_modules']);
/** Transient atomic-write leftovers (see `atomicWriteFile`): `<file>.tmp.<millis>`. */
const TMP_FILE_PATTERN = /\.tmp\.\d+$/;
/** Project data the app rewrites (frontmatter, ensemble.json, name lists). Images are never rewritten. */
const MIGRATION_DATA_PATTERN = /\.(md|json|txt|ya?ml)$/i;
/** Already-compressed formats: stored as-is, deflating them again only burns CPU. */
const STORED_PATTERN = /\.(png|jpe?g|webp|gif|avif|heic|mp3|mp4|m4a|ogg|webm|zip|gz|7z|pdf)$/i;

const SNAPSHOT_PREFIX = 'ensemble-backup-';
const AUTO_SNAPSHOT_PREFIX = 'ensemble-auto-backup-';
const RESTORED_PREFIX = 'ensemble-restored-';
/** Snapshot archives (finished or in progress) and the old default snapshot folder. */
const SNAPSHOT_ARCHIVE_PATTERN = /^ensemble-(?:auto-)?backup-.*\.zip(?:\.partial)?$/i;
const LEGACY_SNAPSHOT_DIR = 'ensemble-backups';
/** Zip comment written into every snapshot, so a renamed one is still recognised. */
const SNAPSHOT_ZIP_COMMENT = 'Ensemble project snapshot';
/** Local file header / empty-archive signatures that open every zip. */
const ZIP_SIGNATURES = ['504b0304', '504b0506'];

/** Project-local snapshot directory, below the excluded backup state folder. */
const DEFAULT_AUTO_BACKUP_FOLDER = 'snapshots';
const STATE_DIR = '.ensemble-backup';
const STATE_FILE = 'state.json';

/** Retention for automatic snapshots when the project does not override it. */
const DEFAULT_AUTO_KEEP = 5;

/**
 * @param {Date} date
 * @returns {string} yyyyMMdd-HHmmss
 */
function formatTimestamp(date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * @param {string} relPath posix-style path relative to the project root
 * @returns {boolean} true when the entry must not be backed up
 */
function isExcluded(relPath) {
  const segments = relPath.split('/');
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return true;
  return TMP_FILE_PATTERN.test(segments[segments.length - 1] || '');
}

/**
 * Snapshot zips (and the old `ensemble-backups/` folder) reached through a link.
 * @param {string} name entry name inside the project
 * @param {string} targetName basename of the link's real target
 * @param {boolean} isDirectory
 * @returns {boolean}
 */
function isSnapshotArchive(name, targetName, isDirectory) {
  if (isDirectory) return name === LEGACY_SNAPSHOT_DIR || targetName === LEGACY_SNAPSHOT_DIR;
  return SNAPSHOT_ARCHIVE_PATTERN.test(name) || SNAPSHOT_ARCHIVE_PATTERN.test(targetName);
}

/**
 * @param {string} relPath posix-style path relative to the project root
 * @returns {boolean} true for text files a storage migration may rewrite
 */
function isMigrationDataFile(relPath) {
  return MIGRATION_DATA_PATTERN.test(relPath);
}

/**
 * @typedef {object} SnapshotInfo
 * @property {string} path absolute path of the zip
 * @property {string} name file name of the zip
 * @property {number} size size in bytes
 * @property {number} fileCount number of project files captured
 * @property {Array<{path: string, reason: string}>} [skipped] entries not captured
 * @property {string} createdAt ISO timestamp of the snapshot
 * @property {boolean} automatic whether this is an automatic (retained) snapshot
 * @property {boolean} [dataOnly] only text files a migration can rewrite (no images)
 */

/**
 * @param {{
 *   fs: typeof import('node:fs'),
 *   path: typeof import('node:path'),
 *   now?: () => Date,
 * }} deps `fs` (node fs, used via `fs.promises`), `path`, and a clock.
 */
function createBackupManager(deps) {
  const { fs, path } = deps;
  const now = deps.now || (() => new Date());
  // `main.js` injects `fs.promises`; unit tests may inject the full `fs` module.
  const fsp = fs.promises || fs;

  const UUID_PATTERN = /^[0-9a-f-]{36}$/;
  /** Shape of `randomUUID()`: every minted identity. Path-derived ids (`pathId`) never match it. */
  const MINTED_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const IDENTITY_FILE = 'identity';
  /**
   * Older ids of this project's snapshots: the owner UUID on the first line, then
   * one id per line. Kept apart from `identity` so older app versions still read it.
   */
  const ALIASES_FILE = 'identity-aliases';
  /**
   * Ids taken over from an old UUID-only identity file: the owner UUID on the first
   * line, then one id per line. Their snapshots are listed only when taken under this
   * folder's name (or the folder they name is gone) and are never pruned.
   */
  const INHERITED_FILE = 'identity-inherited';
  /** Per-project queue so concurrent calls cannot mint two identities for one copy. */
  const identityLocks = new Map();

  /**
   * Deterministic per-folder id, used when the identity file cannot be read or written.
   * Never shaped like a minted UUID, so a moved or renamed read-only project can tell its
   * path-derived snapshots from another project's (see `collectSnapshots`).
   */
  function pathId(real) {
    const id = rawPathId(real);
    // Version nibble 4 -> 0: about 1 in 64 hashes would otherwise look minted.
    return MINTED_ID_PATTERN.test(id) ? `${id.slice(0, 14)}0${id.slice(15)}` : id;
  }

  /** The path-derived id as v1.22.11-v1.26.16 formed it (minted-looking for about 1 in 64 paths). */
  function rawPathId(real) {
    const hex = createHash('sha256').update(real).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** Every path-derived id snapshots of this folder may carry (current form first). */
  function pathIds(real) {
    return [...new Set([pathId(real), rawPathId(real)])];
  }

  /**
   * Identity file: the UUID on the first line, then the real path of the folder
   * it was minted in (older files hold only the UUID). Returns null when missing.
   */
  async function readIdentityFile(projectPath) {
    let raw;
    try {
      raw = await fsp.readFile(path.join(projectPath, STATE_DIR, IDENTITY_FILE), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
    const newline = raw.indexOf('\n');
    const id = (newline === -1 ? raw : raw.slice(0, newline)).replace(/\r$/, '');
    const recorded = newline === -1 ? '' : raw.slice(newline + 1).replace(/\r?\n$/, '');
    return { id: UUID_PATTERN.test(id) ? id : '', recordedPath: recorded };
  }

  /** Atomically (re)write the identity file; false when the project is not writable. */
  async function writeIdentityFile(projectPath, id, real, { exclusive = false } = {}) {
    const dir = path.join(projectPath, STATE_DIR);
    const file = path.join(dir, IDENTITY_FILE);
    const content = `${id}\n${real}\n`;
    try {
      await fsp.mkdir(dir, { recursive: true });
      if (exclusive) {
        await fsp.writeFile(file, content, { flag: 'wx' });
        return true;
      }
      const tmpFile = `${file}.${randomUUID()}.tmp`;
      await fsp.writeFile(tmpFile, content, 'utf8');
      await fsp.rename(tmpFile, file).catch(async (error) => {
        await fsp.rm(tmpFile, { force: true }).catch(() => {});
        throw error;
      });
      return true;
    } catch (error) {
      if (exclusive && error.code === 'EEXIST') throw error;
      if (['ENOENT', 'EACCES', 'EPERM', 'EROFS'].includes(error.code)) return false;
      throw error;
    }
  }

  /** True when `a` and `b` are the same folder (aliases, bind mounts, case-insensitive names). */
  async function sameFolder(a, b) {
    if (a === b) return true;
    const [sa, sb] = await Promise.all([fsp.stat(a).catch(() => null), fsp.stat(b).catch(() => null)]);
    // Some file systems report no inode (0): never treat two folders as one there.
    return !!(sa && sb && sa.ino && sa.dev === sb.dev && sa.ino === sb.ino);
  }

  /**
   * Resolve the backup identity of `projectPath`, checking that it was minted for
   * this folder. A folder copied outside the app (cp -r, a file manager, a sync
   * restore) carries the original's identity file: when the recorded folder still
   * exists with the same identity, this folder is a copy and gets a fresh identity
   * (its listing starts empty); when the recorded folder is gone, the project was
   * moved or renamed and keeps its identity under the new path. Old UUID-only files
   * get a fresh identity and keep the old one as inherited (see `resolveProjectId`).
   * @param {string} projectPath
   * @param {boolean} [create] mint an identity when the project has none
   * @returns {Promise<string>} the UUID ('' when the file is corrupt)
   */
  async function projectId(projectPath, create = false) {
    return (await projectIdentity(projectPath, create)).id;
  }

  /** `projectId` plus the inherited ids: `{ id, inherited }`. */
  async function projectIdentity(projectPath, create = false) {
    const real = await fsp.realpath(projectPath);
    const previous = identityLocks.get(real) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => resolveProjectId(real, create));
    identityLocks.set(real, current);
    try {
      return await current;
    } finally {
      if (identityLocks.get(real) === current) identityLocks.delete(real);
    }
  }

  async function resolveProjectId(real, create) {
    const id = await resolveId(real, create);
    if (id && typeof id === 'object') return id;
    return { id, inherited: id ? await readIdList(real, INHERITED_FILE, id) : [] };
  }

  async function resolveId(real, create) {
    let identity;
    try {
      identity = await readIdentityFile(real);
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
      // A writable destination must still work when the project is unreadable.
      return pathId(real);
    }
    if (!identity) {
      if (!create) return pathId(real);
      const id = randomUUID();
      // Snapshots taken while the project could not be written carry its path-derived
      // id: keep them listed as this project's once it has a UUID.
      if (!(await writeAliases(real, id, pathIds(real)))) return pathId(real);
      try {
        // A writable destination must still work when the project is read-only.
        return (await writeIdentityFile(real, id, real, { exclusive: true })) ? id : pathId(real);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Another process minted the identity first: record the alias under its id.
        const resolved = await resolveId(real, false);
        const winner = typeof resolved === 'object' ? resolved.id : resolved;
        if (winner) await writeAliases(real, winner, pathIds(real));
        return winner;
      }
    }
    const { id, recordedPath } = identity;
    if (!id) return '';
    if (!recordedPath) {
      // Old UUID-only file: a copy made before the path was recorded carries the same
      // file, and nothing tells it from the original. Whichever folder opened first
      // would own (and prune) the other's snapshots, so neither keeps the old id: mint
      // a fresh one and inherit the old one (listed by folder name, never pruned).
      const inherited = [id, ...(await readIdList(real, INHERITED_FILE, id))];
      const fresh = randomUUID();
      const bound =
        (await writeIdList(real, ALIASES_FILE, fresh, [...(await readAliases(real, id)), ...pathIds(real)])) &&
        (await writeIdList(real, INHERITED_FILE, fresh, inherited)) &&
        (await writeIdentityFile(real, fresh, real));
      return { id: bound ? fresh : pathId(real), inherited };
    }
    if (await sameFolder(recordedPath, real)) return id;

    let original = null;
    try {
      original = await readIdentityFile(recordedPath);
    } catch {
      // The recorded folder exists but cannot be checked: never use this identity.
      return pathId(real);
    }
    if (original && original.id === id) {
      // Copy: the original still owns this identity and its snapshots.
      const fresh = randomUUID();
      return (await writeIdentityFile(real, fresh, real)) ? fresh : pathId(real);
    }
    // Move or rename: the recorded folder is gone (or now holds another project).
    await writeIdentityFile(real, id, real);
    return id;
  }

  /** Alias ids recorded for `ownerId` ([] when none, or when they were recorded for another identity). */
  function readAliases(projectPath, ownerId) {
    return readIdList(projectPath, ALIASES_FILE, ownerId);
  }

  /** Ids listed in `file` for `ownerId` ([] when none, or when they were recorded for another identity). */
  async function readIdList(projectPath, file, ownerId) {
    let raw;
    try {
      raw = await fsp.readFile(path.join(projectPath, STATE_DIR, file), 'utf8');
    } catch {
      return [];
    }
    const [owner, ...ids] = raw.split(/\r?\n/);
    // A copy carries the original's file under a fresh identity: ignore it there.
    if (!ownerId || owner !== ownerId) return [];
    return ids.filter((id) => UUID_PATTERN.test(id) && id !== ownerId);
  }

  /** Record `ids` as aliases of `ownerId`; false when the project is not writable. */
  function writeAliases(projectPath, ownerId, ids) {
    return writeIdList(projectPath, ALIASES_FILE, ownerId, ids);
  }

  /** Add `ids` to the `file` list of `ownerId`; false when the project is not writable. */
  async function writeIdList(projectPath, fileName, ownerId, ids) {
    const dir = path.join(projectPath, STATE_DIR);
    const file = path.join(dir, fileName);
    const all = [...new Set([...(await readIdList(projectPath, fileName, ownerId)), ...ids])];
    const tmpFile = `${file}.${randomUUID()}.tmp`;
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(tmpFile, `${[ownerId, ...all].join('\n')}\n`, 'utf8');
      await fsp.rename(tmpFile, file);
      return true;
    } catch (error) {
      await fsp.rm(tmpFile, { force: true }).catch(() => {});
      if (['ENOENT', 'EACCES', 'EPERM', 'EROFS'].includes(error.code)) return false;
      throw error;
    }
  }

  function snapshotIdentity(name) {
    const match = name.match(/^ensemble-(?:auto-)?backup-(.*?)--([0-9a-f-]{36})--/);
    if (!match) return null;
    try {
      const name = decodeURIComponent(match[1]);
      if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) return null;
      return { name, id: match[2] };
    } catch {
      return null;
    }
  }

  /**
   * Recursively collect every backable file under `root`.
   * @param {string} root absolute project path
   * @param {(rel: string) => boolean} [include] keep only files whose relative path passes
   * @returns {Promise<{files: Array, skipped: Array<{path: string, reason: string}>}>}
   */
  async function collectFiles(root, include = () => true) {
    const collected = [];
    const skipped = [];
    const realRoot = await fsp.realpath(root);
    /** True when `real` is the project root or a folder that contains it. */
    function containsProject(real) {
      const rel = path.relative(real, realRoot);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    }
    async function walk(dir, relDir, ancestors, viaLink) {
      const realDir = await fsp.realpath(dir);
      if (ancestors.has(realDir)) {
        skipped.push({ path: relDir, reason: 'Symbolic link loop' });
        return;
      }
      const nextAncestors = new Set([...ancestors, realDir]);
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (isExcluded(rel)) continue;
        try {
          // Resolve links to content, retaining the project's logical zip path.
          // Check target exclusions too: aliases must not capture staged deletes.
          const real = await fsp.realpath(abs);
          const targetRel = path.relative(realRoot, real).split(path.sep).join('/');
          if (isExcluded(targetRel)) {
            skipped.push({ path: rel, reason: 'Target is excluded from backups' });
            continue;
          }
          const linked = viaLink || entry.isSymbolicLink();
          if (linked && containsProject(real)) {
            // e.g. `refs -> ..`: walking it would pull in sibling projects and old backups.
            skipped.push({ path: rel, reason: 'Link points to a folder that contains this project' });
            continue;
          }
          const stats = await fsp.stat(abs);
          if (linked && isSnapshotArchive(entry.name, path.basename(real), stats.isDirectory())) {
            skipped.push({ path: rel, reason: 'Snapshot archives are not added to snapshots' });
            continue;
          }
          if (stats.isDirectory()) {
            await walk(abs, rel, nextAncestors, linked);
          } else if (stats.isFile() && include(rel)) {
            await fsp.access(abs, nodeFs.constants.R_OK);
            if (linked && await isSnapshotZip(abs)) {
              // Renamed snapshots (`my backup.zip`) are recognised by content, not name.
              skipped.push({ path: rel, reason: 'Snapshot archives are not added to snapshots' });
              continue;
            }
            collected.push({ abs, rel, size: stats.size, mtime: stats.mtime, mode: stats.mode });
          } else if (!stats.isFile()) {
            skipped.push({ path: rel, reason: 'Unsupported file type' });
          }
        } catch (error) {
          skipped.push({ path: rel, reason: error.message });
        }
      }
    }
    await walk(root, '', new Set(), false);
    collected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    return { files: collected, skipped };
  }

  /**
   * True when `filePath` is an Ensemble snapshot zip, whatever it is called: it
   * carries the snapshot comment (current snapshots) or holds `ensemble.json` at
   * its root (older snapshots, which had no comment). Reads only the zip header
   * and central directory; anything that is not a readable zip is not a snapshot.
   */
  async function isSnapshotZip(filePath) {
    let handle;
    try {
      handle = await fsp.open(filePath, 'r');
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
      if (bytesRead < 4 || !ZIP_SIGNATURES.includes(buffer.toString('hex'))) return false;
    } catch {
      return false;
    } finally {
      await handle?.close().catch(() => {});
    }
    let zip;
    try {
      zip = await yauzl.openPromise(filePath, { lazyEntries: true, autoClose: false });
      if (zip.comment === SNAPSHOT_ZIP_COMMENT) return true;
      for await (const entry of zip.eachEntry()) {
        if (entry.fileName === 'ensemble.json') return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      zip?.close();
    }
  }

  /** Build a unique `<prefix><timestamp>.zip` name in `dir`, appending `-n` on collision. */
  async function uniqueSnapshotName(dir, prefix, stamp) {
    const base = `${prefix}${stamp}`;
    let candidate = `${base}.zip`;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const exists = await fsp
        .stat(path.join(dir, candidate))
        .then(() => true)
        .catch(() => false);
      if (!exists) return candidate;
      candidate = `${base}-${attempt}.zip`;
    }
    return `${base}-${Date.now()}.zip`;
  }

  async function readBackupSettings(projectPath) {
    try {
      const raw = await fsp.readFile(path.join(projectPath, 'ensemble.json'), 'utf8');
      const metadata = JSON.parse(raw);
      return (metadata && metadata.settings && metadata.settings.backup) || {};
    } catch {
      return {};
    }
  }

  async function readState(projectPath) {
    try {
      const raw = await fsp.readFile(path.join(projectPath, STATE_DIR, STATE_FILE), 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async function writeState(projectPath, state) {
    const dir = path.join(projectPath, STATE_DIR);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * Stream `files` into a zip at `destPath`. Written to a temp name and renamed,
   * so a crash never leaves a truncated zip that looks like a snapshot.
   */
  async function writeZip(files, destPath) {
    const zip = new yazl.ZipFile();
    const tmpPath = `${destPath}.partial`;
    // yazl reports read errors on the ZipFile, not on outputStream: without this
    // the pipeline would wait forever (or the unhandled 'error' would crash main).
    const failed = new Promise((_, reject) => zip.once('error', reject));
    const written = pipeline(zip.outputStream, nodeFs.createWriteStream(tmpPath));
    for (const file of files) {
      // No `size`: a file saved while the backup runs is captured as read instead of
      // failing the whole snapshot on a byte-count mismatch.
      zip.addReadStreamLazy(
        file.rel,
        { mtime: file.mtime, mode: file.mode, compress: !STORED_PATTERN.test(file.rel) },
        (cb) => {
          const readStream = nodeFs.createReadStream(file.abs);
          readStream.on('error', (error) => zip.emit('error', error));
          cb(null, readStream);
        }
      );
    }
    zip.end({ comment: SNAPSHOT_ZIP_COMMENT });
    try {
      await Promise.race([written, failed]);
      await fsp.rename(tmpPath, destPath);
    } catch (error) {
      zip.outputStream.destroy();
      await written.catch(() => {});
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      failed.catch(() => {});
    }
  }

  /**
   * Zip the project folder into `destDir`.
   * @param {string} projectPath
   * @param {string} destDir destination folder (created if missing)
   * @param {{ automatic?: boolean, dataOnly?: boolean }} [opts] `dataOnly` keeps only text files
   *   a migration can rewrite (Markdown, JSON...), leaving images out
   * @returns {Promise<SnapshotInfo>}
   */
  async function createSnapshot(projectPath, destDir, opts = {}) {
    const projectStats = await fsp.stat(projectPath).catch(() => null);
    if (!projectStats || !projectStats.isDirectory()) {
      throw new Error('Project folder does not exist');
    }
    const automatic = !!opts.automatic;
    const dataOnly = !!opts.dataOnly;
    await fsp.mkdir(destDir, { recursive: true });

    const { files, skipped } = await collectFiles(projectPath, dataOnly ? isMigrationDataFile : undefined);

    const stamp = formatTimestamp(now());
    const id = await projectId(projectPath, true);
    if (!id) throw new Error('Invalid backup project identity');
    const prefix = automatic ? AUTO_SNAPSHOT_PREFIX : SNAPSHOT_PREFIX;
    const name = await uniqueSnapshotName(destDir, `${prefix}${encodeURIComponent(path.basename(projectPath))}--${id}--`, stamp);
    const destPath = path.join(destDir, name);
    await writeZip(files, destPath);

    const stats = await fsp.stat(destPath);
    return {
      path: destPath,
      name,
      size: stats.size,
      fileCount: files.length,
      skipped,
      createdAt: now().toISOString(),
      automatic,
      dataOnly,
    };
  }

  /**
   * Stream every file entry of `zipPath` into `folderPath`; returns the entry count.
   * Entries never overwrite existing files and cannot escape `folderPath`.
   */
  async function extractZip(zipPath, folderPath) {
    const zip = await yauzl.openPromise(zipPath, { lazyEntries: true, strictFileNames: true });
    let entryCount = 0;
    for await (const entry of zip.eachEntry()) {
      entryCount += 1;
      // yauzl rejects absolute and `..` names; this is a second guard.
      const target = path.resolve(folderPath, entry.fileName);
      if (target !== folderPath && !target.startsWith(folderPath + path.sep)) {
        throw new Error(`Unsafe path in snapshot: ${entry.fileName}`);
      }
      if (entry.fileName.endsWith('/')) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const readStream = await zip.openReadStreamPromise(entry);
      // flag 'wx' so a restore can never clobber anything already in the target.
      await pipeline(readStream, nodeFs.createWriteStream(target, { flags: 'wx' }));
    }
    return entryCount;
  }

  /** `projectName` as `legacyProjectName` reports it, so the two can be compared. */
  function cleanProjectName(name) {
    if (typeof name !== 'string' || !name.trim()) return undefined;
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100);
  }

  async function currentProjectName(projectPath) {
    try {
      return cleanProjectName(JSON.parse(await fsp.readFile(path.join(projectPath, 'ensemble.json'), 'utf8')).projectName);
    } catch {
      return undefined;
    }
  }

  async function legacyProjectName(zipPath) {
    const zip = await yauzl.openPromise(zipPath, { lazyEntries: true, strictFileNames: true });
    try {
      for await (const entry of zip.eachEntry()) {
        if (entry.fileName !== 'ensemble.json' || entry.uncompressedSize > 1024 * 1024) continue;
        const stream = await zip.openReadStreamPromise(entry);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        try {
          return cleanProjectName(JSON.parse(Buffer.concat(chunks).toString('utf8')).projectName);
        } catch { /* Older or invalid metadata uses the generic restore name. */ }
        return undefined;
      }
    } finally {
      zip.close();
    }
  }

  /**
   * Extract a snapshot into a brand-new folder. Never writes into the live
   * project: the destination is always a fresh `<project>-restored-<stamp>` dir.
   * @param {string} zipPath
   * @param {string} destParentDir folder that will hold the new restored folder
   * @param {{ restoredName?: string }} [opts] legacy caller hint; archive identity takes precedence
   * @returns {Promise<{ folderPath: string, entryCount: number, name: string }>}
   */
  async function restoreSnapshot(zipPath, destParentDir, opts = {}) {
    const zipStats = await fsp.stat(zipPath).catch(() => null);
    if (!zipStats || !zipStats.isFile()) {
      throw new Error('Snapshot file does not exist');
    }
    await fsp.mkdir(destParentDir, { recursive: true });

    const stamp = formatTimestamp(now());
    const snapshotName = snapshotIdentity(path.basename(zipPath))?.name || await legacyProjectName(zipPath);
    const base = snapshotName
      ? `${snapshotName}-${RESTORED_PREFIX}${stamp}`
      : `${RESTORED_PREFIX}${stamp}`;
    let folderName = base;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const exists = await fsp
        .stat(path.join(destParentDir, folderName))
        .then(() => true)
        .catch(() => false);
      if (!exists) break;
      folderName = `${base}-${attempt}`;
    }
    const folderPath = path.join(destParentDir, folderName);
    await fsp.mkdir(folderPath, { recursive: true });

    const entryCount = await extractZip(zipPath, folderPath);
    return { folderPath, entryCount, name: folderName };
  }

  /**
   * List snapshots newest first, scoped to project identity when provided.
   *
   * With a project, the listing holds its own snapshots (current id and recorded
   * aliases) plus, as `legacy` restore-only entries, archives with no project id
   * and archives of an unknown id whose folder name (or, for path-derived ids, whose
   * `projectName`, or the vanished sibling folder their id hashes from) matches this
   * project: snapshots taken while it was read-only and then moved or renamed are
   * never hidden.
   * @param {string} dir
   * @returns {Promise<SnapshotInfo[]>}
   */
  async function listSnapshots(dir, projectPath) {
    return (await collectSnapshots(dir, projectPath)).map(({ owned, ...snapshot }) => snapshot);
  }

  /**
   * `listSnapshots` entries; `owned` is 'id' (current identity, retained), 'alias' or
   * 'inherited' (both never pruned).
   */
  async function collectSnapshots(dir, projectPath) {
    let id = null;
    let aliases = new Set();
    let inherited = new Set();
    const names = new Set();
    let projectName;
    let real;
    if (projectPath) {
      const identity = await projectIdentity(projectPath);
      id = identity.id;
      inherited = new Set(identity.inherited);
      real = await fsp.realpath(projectPath);
      aliases = new Set(await readAliases(real, id));
      // Read-only: snapshots taken here before v1.26.17 may carry the older path-derived id.
      if (id === pathId(real)) pathIds(real).forEach((alias) => alias !== id && aliases.add(alias));
      names.add(path.basename(projectPath)).add(path.basename(real));
      projectName = await currentProjectName(real);
    }
    const takenHereCache = new Map();
    /**
     * True when a snapshot of `oldId` (inherited, or the current id), taken in a folder named `name`,
     * belongs to this project: the name is this folder's, or no folder of that name
     * next to it still carries `oldId` (this project was renamed). A sibling that
     * does carry it is the folder this one was copied from (or a copy of it).
     */
    async function takenHere(name, oldId) {
      if (names.has(name)) return true;
      const key = `${oldId}/${name}`;
      if (!takenHereCache.has(key)) {
        takenHereCache.set(key, (async () => {
          for (const parent of new Set([path.dirname(path.resolve(projectPath)), path.dirname(real)])) {
            const other = path.join(parent, name);
            if (await sameFolder(other, real)) return true;
            let identity;
            try {
              identity = await readIdentityFile(other);
            } catch {
              return false; // A folder of that name exists but cannot be checked.
            }
            if (!identity || !identity.id) continue;
            // A copy not yet opened still records the folder it was copied from.
            if (identity.recordedPath && !(await sameFolder(identity.recordedPath, other))) continue;
            if (identity.id === oldId) return false;
            if ((await readIdList(other, INHERITED_FILE, identity.id)).includes(oldId)) return false;
          }
          return true;
        })());
      }
      return takenHereCache.get(key);
    }
    const renamedCache = new Map();
    /**
     * True when `oldId` is the path-derived id of a folder named `name` next to this one
     * that no longer exists: this project, renamed in place while read-only. Covers ids
     * that look minted (v1.22.11-v1.26.16 hashes, about 1 in 64), which `projectName`
     * matching must skip.
     */
    async function renamedFromHere(name, oldId) {
      const key = `${oldId}/${name}`;
      if (!renamedCache.has(key)) {
        renamedCache.set(key, (async () => {
          for (const parent of new Set([path.dirname(path.resolve(projectPath)), path.dirname(real)])) {
            const before = path.join(parent, name);
            if (!pathIds(before).includes(oldId)) continue;
            // Still there: that folder's snapshots (the original of a copy, or a new project).
            if (await fsp.lstat(before).then(() => true, () => false)) return false;
            return true;
          }
          return false;
        })());
      }
      return renamedCache.get(key);
    }
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.zip')) continue; // also skips in-progress `.zip.partial`
      const automatic = entry.name.startsWith(AUTO_SNAPSHOT_PREFIX);
      if (!automatic && !entry.name.startsWith(SNAPSHOT_PREFIX)) continue;
      const identity = snapshotIdentity(entry.name);
      const abs = path.join(dir, entry.name);
      let owned = null;
      let legacyName;
      if (identity && projectPath) {
        owned = identity.id === id ? 'id' : aliases.has(identity.id) ? 'alias' : null;
        // A copy opened first by v1.26.2-v1.26.15 bound the original's old id to itself:
        // the original's snapshots (named after its folder) are not this project's.
        if (owned === 'id' && !(await takenHere(identity.name, id))) continue;
        if (!owned && inherited.has(identity.id)) {
          // Taken under an old UUID-only identity that a copy may share: never pruned.
          if (!(await takenHere(identity.name, identity.id))) continue;
          owned = 'inherited';
        }
        if (!owned) {
          // Another project's archive, or this one's under an id it no longer knows.
          if (names.has(identity.name)) {
            legacyName = identity.name;
          } else if (await renamedFromHere(identity.name, identity.id)) {
            // Another project in the same folder (a different `projectName`) leaves them alone.
            const archived = projectName ? await legacyProjectName(abs).catch(() => undefined) : undefined;
            if (archived && archived !== projectName) continue;
            legacyName = archived || identity.name;
          } else {
            // A renamed read-only project: match its path-derived ids by `projectName`. Minted
            // ids are skipped so a copy (same ensemble.json) never lists the original's archives.
            const pathDerived = projectName && !MINTED_ID_PATTERN.test(identity.id);
            const archived = pathDerived ? await legacyProjectName(abs).catch(() => undefined) : undefined;
            if (!archived || archived !== projectName) continue;
            legacyName = archived;
          }
        }
      } else if (!identity) {
        legacyName = await legacyProjectName(abs).catch(() => undefined);
      }
      const stats = await fsp.stat(abs);
      snapshots.push({
        path: abs,
        name: entry.name,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        automatic,
        owned,
        ...(projectPath && !owned || !identity ? { legacy: true, legacyProjectName: legacyName } : {}),
      });
    }
    const oldDir = projectPath && path.join(path.dirname(projectPath), 'ensemble-backups');
    if (oldDir && path.resolve(dir) !== path.resolve(oldDir)) {
      snapshots.push(...(await collectSnapshots(oldDir, projectPath)).filter((s) => s.legacy));
    }
    snapshots.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return snapshots;
  }

  /**
   * Keep only the newest `keepN` automatic snapshots in `dir`, deleting older
   * ones carrying projectPath's current id. Manual, unattributed, older-id
   * (aliased) and other projects' snapshots are untouched.
   * @param {string} dir
   * @param {number} keepN
   * @returns {Promise<{ removed: string[], kept: string[] }>}
   */
  async function pruneSnapshots(dir, keepN, projectPath) {
    if (!projectPath) return { removed: [], kept: [] };
    const keep = Number.isFinite(keepN) ? Math.max(0, Math.floor(keepN)) : DEFAULT_AUTO_KEEP;
    const snapshots = (await collectSnapshots(dir, projectPath)).filter((s) => s.automatic && s.owned === 'id');
    const kept = snapshots.slice(0, keep);
    const removed = snapshots.slice(keep);
    for (const snapshot of removed) {
      await fsp.rm(snapshot.path, { force: true });
    }
    return { removed: removed.map((s) => s.name), kept: kept.map((s) => s.name) };
  }

  /**
   * Take an automatic snapshot before a storage migration runs on project open.
   *
   * A migration is "pending" when the app version that last opened the project
   * differs from the current one (an update may rewrite stored data). The first
   * open just records the version. When a migration is pending and the project
   * enables automatic snapshots, the project's text files (the only files a
   * migration rewrites) are snapshotted into its backup folder and pruned to the
   * retention count. Images are left out: a full zip of a multi-gigabyte project
   * would hold up every project open after an update.
   *
   * @param {string} projectPath
   * @param {{ currentAppVersion: string, defaultKeep?: number }} opts
   * @returns {Promise<{ reason: string, snapshot?: SnapshotInfo, pruned?: { removed: string[], kept: string[] }, backupDir?: string }>}
   */
  async function maybeAutoSnapshotBeforeMigration(projectPath, opts) {
    const currentVersion = opts.currentAppVersion;
    const settings = await readBackupSettings(projectPath);
    const state = await readState(projectPath);

    if (state.lastAppVersion === undefined) {
      await writeState(projectPath, { ...state, lastAppVersion: currentVersion });
      return { reason: 'first-open' };
    }
    if (settings.autoBeforeMigration === false) {
      return { reason: 'disabled' };
    }
    if (state.lastAppVersion === currentVersion) {
      return { reason: 'no-migration' };
    }

    const backupDir = settings.backupFolder
      ? settings.backupFolder
      : path.join(projectPath, STATE_DIR, DEFAULT_AUTO_BACKUP_FOLDER);
    const keep = Number.isFinite(settings.keepAutomatic) ? settings.keepAutomatic : opts.defaultKeep ?? DEFAULT_AUTO_KEEP;

    const snapshot = await createSnapshot(projectPath, backupDir, { automatic: true, dataOnly: true });
    const pruned = await pruneSnapshots(backupDir, keep, projectPath);
    await writeState(projectPath, { ...state, lastAppVersion: currentVersion });
    return { reason: 'migrated', snapshot, pruned, backupDir };
  }

  return {
    createSnapshot,
    restoreSnapshot,
    listSnapshots,
    pruneSnapshots,
    maybeAutoSnapshotBeforeMigration,
  };
}

module.exports = {
  createBackupManager,
  formatTimestamp,
  isExcluded,
  isMigrationDataFile,
  EXCLUDED_DIRS,
  SNAPSHOT_PREFIX,
  AUTO_SNAPSHOT_PREFIX,
  RESTORED_PREFIX,
  DEFAULT_AUTO_KEEP,
  DEFAULT_AUTO_BACKUP_FOLDER,
};
