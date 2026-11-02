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

/** Where automatic snapshots go when the project has no configured backup folder. */
const DEFAULT_AUTO_BACKUP_FOLDER = 'ensemble-backups';
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

  /**
   * Recursively collect every backable file under `root`.
   * @param {string} root absolute project path
   * @param {(rel: string) => boolean} [include] keep only files whose relative path passes
   * @returns {Promise<Array<{ abs: string, rel: string, size: number, mtime: Date, mode: number }>>}
   */
  async function collectFiles(root, include = () => true) {
    const collected = [];
    async function walk(dir, relDir) {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (isExcluded(rel)) continue;
        if (entry.isDirectory()) {
          await walk(abs, rel);
        } else if (entry.isFile() && include(rel)) {
          const stats = await fsp.stat(abs);
          collected.push({ abs, rel, size: stats.size, mtime: stats.mtime, mode: stats.mode });
        }
      }
    }
    await walk(root, '');
    collected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    return collected;
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
    zip.end();
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

    const files = await collectFiles(projectPath, dataOnly ? isMigrationDataFile : undefined);

    const stamp = formatTimestamp(now());
    const name = await uniqueSnapshotName(destDir, automatic ? AUTO_SNAPSHOT_PREFIX : SNAPSHOT_PREFIX, stamp);
    const destPath = path.join(destDir, name);
    await writeZip(files, destPath);

    const stats = await fsp.stat(destPath);
    return {
      path: destPath,
      name,
      size: stats.size,
      fileCount: files.length,
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

  /**
   * Extract a snapshot into a brand-new folder. Never writes into the live
   * project: the destination is always a fresh `<project>-restored-<stamp>` dir.
   * @param {string} zipPath
   * @param {string} destParentDir folder that will hold the new restored folder
   * @param {{ restoredName?: string }} [opts] base name for the restored folder
   * @returns {Promise<{ folderPath: string, entryCount: number, name: string }>}
   */
  async function restoreSnapshot(zipPath, destParentDir, opts = {}) {
    const zipStats = await fsp.stat(zipPath).catch(() => null);
    if (!zipStats || !zipStats.isFile()) {
      throw new Error('Snapshot file does not exist');
    }
    await fsp.mkdir(destParentDir, { recursive: true });

    const stamp = formatTimestamp(now());
    const base = opts.restoredName
      ? `${opts.restoredName}-${RESTORED_PREFIX}${stamp}`
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
   * List the snapshots in `dir`, newest first.
   * @param {string} dir
   * @returns {Promise<SnapshotInfo[]>}
   */
  async function listSnapshots(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.zip')) continue; // also skips in-progress `.zip.partial`
      const automatic = entry.name.startsWith(AUTO_SNAPSHOT_PREFIX);
      if (!automatic && !entry.name.startsWith(SNAPSHOT_PREFIX)) continue;
      const abs = path.join(dir, entry.name);
      const stats = await fsp.stat(abs);
      snapshots.push({
        path: abs,
        name: entry.name,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        automatic,
      });
    }
    snapshots.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return snapshots;
  }

  /**
   * Keep only the newest `keepN` automatic snapshots in `dir`, deleting older
   * ones. Manual snapshots are left untouched.
   * @param {string} dir
   * @param {number} keepN
   * @returns {Promise<{ removed: string[], kept: string[] }>}
   */
  async function pruneSnapshots(dir, keepN) {
    const keep = Number.isFinite(keepN) ? Math.max(0, Math.floor(keepN)) : DEFAULT_AUTO_KEEP;
    const snapshots = (await listSnapshots(dir)).filter((s) => s.automatic);
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
      : path.join(path.dirname(projectPath), DEFAULT_AUTO_BACKUP_FOLDER);
    const keep = Number.isFinite(settings.keepAutomatic) ? settings.keepAutomatic : opts.defaultKeep ?? DEFAULT_AUTO_KEEP;

    const snapshot = await createSnapshot(projectPath, backupDir, { automatic: true, dataOnly: true });
    const pruned = await pruneSnapshots(backupDir, keep);
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
