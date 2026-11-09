const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  createBackupManager,
  isExcluded,
  isMigrationDataFile,
  SNAPSHOT_PREFIX,
  AUTO_SNAPSHOT_PREFIX,
} = require('./backup-manager');

const manager = createBackupManager({ fs, path });

/** Build a small fake project tree and return its root. */
async function makeProject(root) {
  await fsp.mkdir(path.join(root, 'characters'), { recursive: true });
  await fsp.mkdir(path.join(root, 'locations', '_nested'), { recursive: true });
  await fsp.mkdir(path.join(root, 'img'), { recursive: true });
  await fsp.writeFile(path.join(root, 'ensemble.json'), '{"settings":{}}', 'utf8');
  await fsp.writeFile(path.join(root, 'characters', 'mara.md'), '# Mara', 'utf8');
  await fsp.writeFile(path.join(root, 'locations', '_port.md'), '# Port', 'utf8');
  await fsp.writeFile(path.join(root, 'locations', '_nested', 'deep.md'), '# Deep', 'utf8');
  await fsp.writeFile(path.join(root, 'img', 'portrait.webp'), 'binary', 'utf8');
  return root;
}

/** Write a plain zip (no snapshot comment) holding `entries` (name -> text). */
async function writeTestZip(zipPath, entries) {
  const yazl = require('yazl');
  const zip = new yazl.ZipFile();
  for (const [name, text] of Object.entries(entries)) zip.addBuffer(Buffer.from(text), name);
  zip.end();
  await require('node:stream/promises').pipeline(zip.outputStream, fs.createWriteStream(zipPath));
}

describe('backup-manager', () => {
  let tmp;
  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ensemble-backup-'));
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test('manual snapshots work with a read-only project and a writable destination', async () => {
    const project = await makeProject(path.join(tmp, 'Readonly'));
    const deniedFs = { ...fsp, mkdir: async (dir, opts) => {
      if (dir === path.join(project, '.ensemble-backup')) {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
      return fsp.mkdir(dir, opts);
    } };
    const readonlyManager = createBackupManager({ fs: deniedFs, path });
    const result = await readonlyManager.createSnapshot(project, path.join(tmp, 'writable')).then(
      snapshot => ({ snapshot }), error => ({ error: error.message }));
    assert.equal(result.error, undefined, 'manual snapshot must not require a writable project');
    assert.equal(result.snapshot.fileCount, 5);
    assert.equal((await readonlyManager.listSnapshots(path.join(tmp, 'writable'), project)).length, 1);
    const restored = await readonlyManager.restoreSnapshot(result.snapshot.path, path.join(tmp, 'restored'));
    assert.equal(await fsp.readFile(path.join(restored.folderPath, 'characters', 'mara.md'), 'utf8'), '# Mara');
  });

  test('legacy snapshots from old default and custom folders remain restore-only and never pruned', async () => {
    const project = await makeProject(path.join(tmp, 'Novel'));
    await fsp.writeFile(path.join(project, 'ensemble.json'), '{"projectName":"Old Novel"}');
    const oldDir = path.join(tmp, 'ensemble-backups');
    const created = await manager.createSnapshot(project, oldDir, { automatic: true });
    const legacy = path.join(oldDir, 'ensemble-auto-backup-20260101-000000.zip');
    await fsp.rename(created.path, legacy);
    const defaults = await manager.listSnapshots(path.join(project, '.ensemble-backup', 'snapshots'), project);
    assert.equal(defaults.length, 1, 'old default snapshots must remain visible');
    assert.equal(defaults[0].legacy, true);
    assert.equal(defaults[0].legacyProjectName, 'Old Novel');
    const custom = await manager.listSnapshots(oldDir, project);
    assert.equal(custom.length, 1, 'unattributed custom snapshots must remain visible');
    assert.equal(custom[0].legacy, true);
    assert.deepEqual((await manager.pruneSnapshots(oldDir, 0, project)).removed, []);
    await fsp.access(legacy);
    const restored = await manager.restoreSnapshot(legacy, path.join(tmp, 'restored'));
    assert.ok(restored.name.startsWith('Old Novel-'));
  });

  describe('isExcluded', () => {
    test('skips trash, backup state, node_modules and atomic tmp files', () => {
      assert.equal(isExcluded('.ensemble-trash/entry/manifest.json'), true);
      assert.equal(isExcluded('.ensemble-backup/state.json'), true);
      assert.equal(isExcluded('node_modules/pkg/index.js'), true);
      assert.equal(isExcluded('characters/mara.md.tmp.1712345'), true);
      assert.equal(isExcluded('characters/mara.md'), false);
      assert.equal(isExcluded('img/portrait.webp'), false);
    });
  });

  test('createSnapshot zips every project file except caches and trash', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    // Noise that must not be captured.
    await fsp.mkdir(path.join(project, '.ensemble-trash', 'entry'), { recursive: true });
    await fsp.writeFile(path.join(project, '.ensemble-trash', 'entry', 'manifest.json'), '{}', 'utf8');
    await fsp.writeFile(path.join(project, 'characters', 'draft.md.tmp.999'), 'tmp', 'utf8');

    const dest = path.join(tmp, 'backups');
    const snapshot = await manager.createSnapshot(project, dest);

    assert.equal(snapshot.automatic, false);
    assert.ok(snapshot.name.startsWith(SNAPSHOT_PREFIX));
    assert.ok(snapshot.name.endsWith('.zip'));
    assert.ok(snapshot.size > 0);
    // 5 real files: ensemble.json, mara.md, _port.md, deep.md, portrait.webp
    assert.equal(snapshot.fileCount, 5);
    assert.ok(fs.existsSync(snapshot.path));

    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.ok(fs.existsSync(path.join(restored.folderPath, 'characters', 'mara.md')));
    assert.ok(fs.existsSync(path.join(restored.folderPath, 'locations', '_nested', 'deep.md')));
    assert.equal(fs.existsSync(path.join(restored.folderPath, '.ensemble-trash')), false);
    assert.equal(fs.existsSync(path.join(restored.folderPath, 'characters', 'draft.md.tmp.999')), false);
    assert.equal(restored.entryCount, 5);
  });

  test('isMigrationDataFile keeps text data and leaves images out', () => {
    assert.equal(isMigrationDataFile('ensemble.json'), true);
    assert.equal(isMigrationDataFile('characters/mara/mara.md'), true);
    assert.equal(isMigrationDataFile('names/list.TXT'), true);
    assert.equal(isMigrationDataFile('img/portrait.webp'), false);
    assert.equal(isMigrationDataFile('characters/mara/mara.png'), false);
  });

  test('createSnapshot keeps file contents byte for byte, images included', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const image = Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 7919) % 256));
    await fsp.writeFile(path.join(project, 'img', 'big.png'), image);

    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.deepEqual(fs.readFileSync(path.join(restored.folderPath, 'img', 'big.png')), image);
    assert.equal(fs.readFileSync(path.join(restored.folderPath, 'characters', 'mara.md'), 'utf8'), '# Mara');
  });

  test('createSnapshot reports an unreadable file as skipped', async (t) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('needs POSIX permissions');
    const project = await makeProject(path.join(tmp, 'proj'));
    const locked = path.join(project, 'characters', 'locked.md');
    await fsp.writeFile(locked, 'secret', 'utf8');
    await fsp.chmod(locked, 0o000);
    const dest = path.join(tmp, 'backups');
    try {
      let snapshot;
      try {
        snapshot = await manager.createSnapshot(project, dest);
      } catch (error) {
        assert.fail('Snapshot should report unreadable file instead of rejecting: ' + error.message);
      }
      assert.equal(snapshot.skipped?.length, 1);
      assert.equal(snapshot.skipped[0].path, 'characters/locked.md');
    } finally {
      await fsp.chmod(locked, 0o644);
    }
    assert.equal((await fsp.readdir(dest)).filter((name) => name.endsWith('.zip')).length, 1);
  });

  test('snapshot follows shared character folders and file aliases and restores their content', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const shared = path.join(tmp, 'shared');
    await fsp.mkdir(shared);
    await fsp.writeFile(path.join(shared, 'ilse.md'), '# Ilse');
    await fsp.writeFile(path.join(shared, 'ilse.lc1.md'), '# Book notes');
    await fsp.symlink(shared, path.join(project, 'characters', 'ilse'));
    await fsp.symlink(path.join(project, 'ensemble.json'), path.join(project, 'alias.json'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    assert.equal(snapshot.fileCount, 8);
    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.equal(await fsp.readFile(path.join(restored.folderPath, 'characters/ilse/ilse.md'), 'utf8'), '# Ilse');
    assert.equal(await fsp.readFile(path.join(restored.folderPath, 'characters/ilse/ilse.lc1.md'), 'utf8'), '# Book notes');
    assert.equal(await fsp.readFile(path.join(restored.folderPath, 'alias.json'), 'utf8'), '{"settings":{}}');
    assert.deepEqual(snapshot.skipped, []);
  });

  test('snapshot reports broken links, loops and aliases to trash with paths', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    await fsp.mkdir(path.join(project, '.ensemble-trash'));
    await fsp.symlink(path.join(tmp, 'missing'), path.join(project, 'broken'));
    await fsp.symlink(project, path.join(project, 'loop'));
    await fsp.symlink(path.join(project, '.ensemble-trash'), path.join(project, 'trash-alias'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    assert.deepEqual(snapshot.skipped?.map(item => item.path).sort(), ['broken', 'loop', 'trash-alias']);
    assert.equal(snapshot.fileCount, 5);
  });

  test('snapshot skips links to a folder that contains the project and captures none of it', async () => {
    const writing = path.join(tmp, 'Writing');
    const project = await makeProject(path.join(writing, 'Novel C'));
    await fsp.mkdir(path.join(writing, 'Other Novel'));
    await fsp.writeFile(path.join(writing, 'Other Novel', 'secret.md'), '# Secret');
    await fsp.mkdir(path.join(writing, 'ensemble-backups'));
    await fsp.writeFile(path.join(writing, 'ensemble-backups', 'ensemble-backup-20240101-000000.zip'), 'zip');
    await fsp.symlink('..', path.join(project, 'writing-link'));
    await fsp.symlink(tmp, path.join(project, 'img', 'grandparent'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    const reason = 'Link points to a folder that contains this project';
    assert.deepEqual(
      snapshot.skipped.slice().sort((a, b) => a.path.localeCompare(b.path)),
      [{ path: 'img/grandparent', reason }, { path: 'writing-link', reason }]);
    assert.equal(snapshot.fileCount, 5, 'only the project files are captured');
    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    await assert.rejects(() => fsp.access(path.join(restored.folderPath, 'writing-link')));
    await assert.rejects(() => fsp.access(path.join(restored.folderPath, 'img', 'grandparent')));
  });

  test('snapshot never adds snapshot archives reached through a link but keeps the shared folder', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const shared = path.join(tmp, 'shared');
    await fsp.mkdir(path.join(shared, 'ensemble-backups'), { recursive: true });
    await fsp.writeFile(path.join(shared, 'ilse.md'), '# Ilse');
    await fsp.writeFile(path.join(shared, 'ensemble-backup-20240101-000000.zip'), 'zip');
    await fsp.writeFile(path.join(shared, 'ensemble-auto-backup-20240101-000000.zip'), 'zip');
    await fsp.writeFile(path.join(shared, 'ensemble-backups', 'other.zip'), 'zip');
    await fsp.symlink(shared, path.join(project, 'characters', 'ilse'));
    await fsp.symlink(path.join(shared, 'ensemble-backup-20240101-000000.zip'), path.join(project, 'old.zip'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    assert.deepEqual(snapshot.skipped.map(item => item.path).sort(), [
      'characters/ilse/ensemble-auto-backup-20240101-000000.zip',
      'characters/ilse/ensemble-backup-20240101-000000.zip',
      'characters/ilse/ensemble-backups',
      'old.zip',
    ]);
    assert.equal(snapshot.fileCount, 6, 'project files plus the shared character file');
    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.equal(await fsp.readFile(path.join(restored.folderPath, 'characters/ilse/ilse.md'), 'utf8'), '# Ilse');
    assert.deepEqual((await fsp.readdir(path.join(restored.folderPath, 'characters/ilse'))), ['ilse.md']);
    await assert.rejects(() => fsp.access(path.join(restored.folderPath, 'old.zip')));
  });

  test('snapshot never adds a renamed snapshot zip reached through a link, old or new', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const other = await makeProject(path.join(tmp, 'other'));
    const shared = path.join(tmp, 'shared');
    await fsp.mkdir(shared);
    await fsp.writeFile(path.join(shared, 'ilse.md'), '# Ilse');
    // A real snapshot, renamed by the user.
    const real = await manager.createSnapshot(other, path.join(tmp, 'elsewhere'));
    await fsp.copyFile(real.path, path.join(shared, 'my renamed backup.zip'));
    await fsp.copyFile(real.path, path.join(shared, 'no extension'));
    // An older snapshot (no snapshot comment) is a zip with ensemble.json at its root.
    await writeTestZip(path.join(shared, 'old copy.zip'), { 'ensemble.json': '{}', 'characters/a.md': '# A' });
    // An ordinary zip in the shared folder is still captured, as is a truncated one.
    await writeTestZip(path.join(shared, 'maps.zip'), { 'map.txt': 'map', 'nested/ensemble.json': '{}' });
    await fsp.writeFile(path.join(shared, 'broken.zip'), Buffer.from('504b0304deadbeef', 'hex'));
    await fsp.symlink(shared, path.join(project, 'characters', 'sharedlink'));
    await fsp.symlink(path.join(shared, 'my renamed backup.zip'), path.join(project, 'direct.zip'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    const reason = 'Snapshot archives are not added to snapshots';
    assert.deepEqual(snapshot.skipped.slice().sort((a, b) => a.path.localeCompare(b.path)), [
      { path: 'characters/sharedlink/my renamed backup.zip', reason },
      { path: 'characters/sharedlink/no extension', reason },
      { path: 'characters/sharedlink/old copy.zip', reason },
      { path: 'direct.zip', reason },
    ]);
    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.deepEqual((await fsp.readdir(path.join(restored.folderPath, 'characters/sharedlink'))).sort(),
      ['broken.zip', 'ilse.md', 'maps.zip']);
    await assert.rejects(() => fsp.access(path.join(restored.folderPath, 'direct.zip')));
  });

  test('a snapshot zip in the project itself (not through a link) is still captured', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const other = await makeProject(path.join(tmp, 'other'));
    const real = await manager.createSnapshot(other, path.join(tmp, 'elsewhere'));
    await fsp.copyFile(real.path, path.join(project, 'img', 'kept.zip'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));
    assert.deepEqual(snapshot.skipped, []);
    assert.equal(snapshot.fileCount, 6);
  });

  test('snapshot reports a directory that cannot be read', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const injected = { ...fsp, readdir: async (dir, opts) => {
      if (dir === path.join(project, 'characters')) throw new Error('EACCES: denied');
      return fsp.readdir(dir, opts);
    }};
    let snapshot;
    try {
      snapshot = await createBackupManager({ fs: injected, path }).createSnapshot(project, path.join(tmp, 'backups'));
    } catch (error) {
      assert.fail('Snapshot should report unreadable directory instead of rejecting: ' + error.message);
    }
    assert.deepEqual(snapshot.skipped, [{ path: 'characters', reason: 'EACCES: denied' }]);
    assert.equal(snapshot.fileCount, 4);
  });

  test('createSnapshot on a missing project throws and writes nothing', async () => {
    const dest = path.join(tmp, 'backups');
    await assert.rejects(
      () => manager.createSnapshot(path.join(tmp, 'nope'), dest),
      /does not exist/
    );
  });

  test('restoreSnapshot extracts into a new folder and never overwrites the project', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const snapshot = await manager.createSnapshot(project, path.join(tmp, 'backups'));

    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.notEqual(restored.folderPath, project);
    assert.ok(restored.folderPath.includes('restored'));
    // The live project is untouched.
    assert.equal(fs.readFileSync(path.join(project, 'characters', 'mara.md'), 'utf8'), '# Mara');
    // A second restore gets its own folder.
    const again = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'));
    assert.notEqual(again.folderPath, restored.folderPath);
  });

  test('restoreSnapshot on a missing zip throws', async () => {
    await assert.rejects(
      () => manager.restoreSnapshot(path.join(tmp, 'nope.zip'), path.join(tmp, 'restored')),
      /does not exist/
    );
  });

  test('listSnapshots returns snapshots newest first and flags automatic ones', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const dest = path.join(tmp, 'backups');
    const manual = await manager.createSnapshot(project, dest);
    const auto1 = await manager.createSnapshot(project, dest, { automatic: true });
    const auto2 = await manager.createSnapshot(project, dest, { automatic: true });

    const list = await manager.listSnapshots(dest);
    assert.equal(list.length, 3);
    assert.equal(list.filter((s) => s.automatic).length, 2);
    assert.equal(list.filter((s) => !s.automatic).length, 1);
    const names = list.map((s) => s.name);
    assert.equal(new Set(names).size, 3, 'all three names are unique');
  });

  test('pruneSnapshots keeps the newest N automatic snapshots and never touches manual ones', async () => {
    const project = await makeProject(path.join(tmp, 'proj'));
    const dest = path.join(tmp, 'backups');
    const manual = await manager.createSnapshot(project, dest);
    // Three automatic snapshots, distinct names via clock injection below.
    const autos = [];
    for (let i = 0; i < 3; i += 1) {
      const autoManager = createBackupManager({ fs, path, now: () => new Date(2026, 0, 1, 0, 0, i) });
      autos.push(await autoManager.createSnapshot(project, dest, { automatic: true }));
    }

    const result = await manager.pruneSnapshots(dest, 1, project);
    assert.equal(result.kept.length, 1);
    assert.equal(result.removed.length, 2);

    const remaining = await manager.listSnapshots(dest);
    // One automatic (the kept one) plus the manual snapshot survive.
    assert.equal(remaining.filter((s) => s.automatic).length, 1);
    assert.equal(remaining.filter((s) => !s.automatic).length, 1);
    assert.ok(fs.existsSync(manual.path), 'manual snapshot is never pruned');
  });

  test('shared folder listing excludes other projects and labels legacy snapshots', async () => {
    const a = await makeProject(path.join(tmp, 'Novel A'));
    const b = await makeProject(path.join(tmp, 'Novel B'));
    const dest = path.join(tmp, 'backups');
    await manager.createSnapshot(a, dest);
    const own = await manager.createSnapshot(b, dest);
    await fsp.writeFile(path.join(dest, 'ensemble-backup-legacy.zip'), 'unknown');
    assert.deepEqual((await manager.listSnapshots(dest, b)).filter(s => !s.legacy).map(s => s.name), [own.name],
      'listing must contain only the current project');
  });

  test('shared folder retention preserves other projects and unattributed archives', async () => {
    const a = await makeProject(path.join(tmp, 'Novel A'));
    const b = await makeProject(path.join(tmp, 'Novel B'));
    const dest = path.join(tmp, 'backups');
    const other = await manager.createSnapshot(a, dest, { automatic: true });
    await manager.createSnapshot(b, dest, { automatic: true });
    const legacy = path.join(dest, 'ensemble-auto-backup-legacy.zip');
    await fsp.writeFile(legacy, 'unknown');
    const result = await manager.pruneSnapshots(dest, 0, b);
    assert.equal(fs.existsSync(other.path), true, 'other project snapshot must survive retention');
    assert.equal(fs.existsSync(legacy), true, 'unattributed snapshot must survive retention');
    assert.equal(result.removed.length, 1);
    assert.deepEqual(await manager.pruneSnapshots(dest, 0), { removed: [], kept: [] });
  });

  test('restore uses the snapshot project name instead of the open project name', async () => {
    const a = await makeProject(path.join(tmp, 'Novel A'));
    const snapshot = await manager.createSnapshot(a, path.join(tmp, 'backups'));
    const restored = await manager.restoreSnapshot(snapshot.path, path.join(tmp, 'restored'),
      { restoredName: 'Novel B' });
    assert.ok(restored.name.startsWith('Novel A-ensemble-restored-'),
      'restored folder must name the snapshot project');
  });

  test('legacy restore names the folder from archive metadata', async () => {
    const a = await makeProject(path.join(tmp, 'Novel A'));
    await fsp.writeFile(path.join(a, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A' }));
    const snapshot = await manager.createSnapshot(a, path.join(tmp, 'backups'));
    const legacy = path.join(tmp, 'ensemble-backup-legacy.zip');
    await fsp.rename(snapshot.path, legacy);
    const restored = await manager.restoreSnapshot(legacy, path.join(tmp, 'restored'),
      { restoredName: 'Novel B' });
    assert.ok(restored.name.startsWith('Novel A-ensemble-restored-'),
      'legacy restore must use the archived project name');
  });

  test('identity persists across managers and default backups are isolated and excluded', async () => {
    const a = await makeProject(path.join(tmp, 'Novel A'));
    const b = await makeProject(path.join(tmp, 'Novel B'));
    for (const project of [a, b]) {
      await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1' });
    }
    const first = await manager.maybeAutoSnapshotBeforeMigration(a, { currentAppVersion: '2' });
    const second = await manager.maybeAutoSnapshotBeforeMigration(b, { currentAppVersion: '2' });
    assert.notEqual(first.backupDir, second.backupDir, 'default backup locations must differ');
    const fresh = createBackupManager({ fs, path });
    assert.equal((await fresh.listSnapshots(first.backupDir, a)).length, 1);
    const snapshot = await fresh.createSnapshot(a, first.backupDir);
    assert.equal(snapshot.fileCount, 5, 'backup state and snapshots must not back themselves up');
  });

  describe('project copied outside the app', () => {
    async function threeAutoSnapshots(project, dest, minute = 0) {
      const made = [];
      for (let i = 0; i < 3; i += 1) {
        const date = new Date(2026, 0, 1, 0, minute, i);
        const snapshot = await createBackupManager({ fs, path, now: () => date })
          .createSnapshot(project, dest, { automatic: true });
        // Listings sort by mtime: zips written in the same clock tick would tie.
        await fsp.utimes(snapshot.path, date, date);
        made.push(snapshot);
      }
      return made;
    }

    test('cp -r copy never lists or prunes the original snapshots in a shared folder', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = await threeAutoSnapshots(a, shared);
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(a, copy, { recursive: true });

      assert.deepEqual(await manager.listSnapshots(shared, copy), [], 'a copy must start with an empty listing');
      const own = await createBackupManager({ fs, path, now: () => new Date(2026, 0, 1, 0, 5, 0) })
        .createSnapshot(copy, shared, { automatic: true });
      const pruned = await manager.pruneSnapshots(shared, 1, copy);
      assert.deepEqual(pruned.removed, [], 'pruning the copy must not remove the original snapshots');
      assert.deepEqual(pruned.kept, [own.name]);
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);

      const listedA = (await manager.listSnapshots(shared, a)).map((s) => s.name).sort();
      assert.deepEqual(listedA, originals.map((s) => s.name).sort(), 'the original keeps exactly its own snapshots');
      const fresh = createBackupManager({ fs, path });
      assert.deepEqual((await fresh.listSnapshots(shared, copy)).map((s) => s.name), [own.name],
        'the copy identity persists across managers');
    });

    test('a copy with the same projectName lists none of the original snapshots', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      await fsp.writeFile(path.join(a, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A', settings: {} }));
      const shared = path.join(tmp, 'shared');
      await threeAutoSnapshots(a, shared);
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(a, copy, { recursive: true });
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
    });

    test('a copy pruned before any listing still keeps the original snapshots', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = await threeAutoSnapshots(a, shared);
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(a, copy, { recursive: true });
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path));
    });

    test('renaming or moving a project keeps its snapshots listed and retained', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = await threeAutoSnapshots(a, shared);
      const renamed = path.join(tmp, 'Novel A renamed');
      await fsp.rename(a, renamed);
      assert.equal((await manager.listSnapshots(shared, renamed)).length, 3, 'renamed project keeps its snapshots');

      await fsp.mkdir(path.join(tmp, 'elsewhere'));
      const moved = path.join(tmp, 'elsewhere', 'Novel A');
      await fsp.rename(renamed, moved);
      const pruned = await manager.pruneSnapshots(shared, 2, moved);
      assert.equal(pruned.kept.length, 2, 'retention still applies to the moved project');
      assert.deepEqual(pruned.removed, [originals[0].name]);
      assert.equal((await manager.listSnapshots(shared, moved)).length, 2);
    });

    test('a project moved away and replaced by another keeps its identity', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      await threeAutoSnapshots(a, shared);
      const moved = path.join(tmp, 'Novel A moved');
      await fsp.rename(a, moved);
      const other = await makeProject(a);
      await manager.createSnapshot(other, shared);
      assert.equal((await manager.listSnapshots(shared, moved)).length, 3);
    });

    test('old UUID-only identity files keep every snapshot listed', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = await threeAutoSnapshots(a, shared);
      const identityFile = path.join(a, '.ensemble-backup', 'identity');
      const id = (await fsp.readFile(identityFile, 'utf8')).split('\n')[0];
      await fsp.writeFile(identityFile, id); // v1.26.1 format: the UUID alone
      const listed = (await manager.listSnapshots(shared, a)).map((s) => s.name).sort();
      assert.deepEqual(listed, originals.map((s) => s.name).sort());
      const [upgradedId, recorded] = (await fsp.readFile(identityFile, 'utf8')).split('\n');
      assert.equal(recorded, await fsp.realpath(a), 'the old file is upgraded with the project path');
      assert.notEqual(upgradedId, id, 'the old id is inherited, never used to prune');
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(a, copy, { recursive: true });
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
    });

    /** Rewrite `project`'s identity file in the v1.26.1 format (the UUID alone); returns the UUID. */
    async function makeLegacy(project) {
      const identityFile = path.join(project, '.ensemble-backup', 'identity');
      const id = (await fsp.readFile(identityFile, 'utf8')).split('\n')[0];
      await fsp.writeFile(identityFile, id);
      return id;
    }

    /** Original with 3 automatic snapshots and a UUID-only identity, plus a `cp -r` copy of it. */
    async function legacyOriginalAndCopy() {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = await threeAutoSnapshots(a, shared);
      const id = await makeLegacy(a);
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(a, copy, { recursive: true });
      return { a, shared, originals, id, copy };
    }

    test('a cp -r copy of an old UUID-only project opened first never lists or prunes the original snapshots', async () => {
      const { a, shared, originals, copy } = await legacyOriginalAndCopy();
      assert.deepEqual(await manager.listSnapshots(shared, copy), [], 'copy opened first lists none');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, [], 'pruning the copy removes none');
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);

      const own = await createBackupManager({ fs, path, now: () => new Date(2026, 0, 1, 0, 5, 0) })
        .createSnapshot(copy, shared, { automatic: true });
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, [own.name]);
      assert.deepEqual((await manager.listSnapshots(shared, copy)).map((s) => s.name), []);

      const listedA = (await createBackupManager({ fs, path }).listSnapshots(shared, a)).map((s) => s.name).sort();
      assert.deepEqual(listedA, originals.map((s) => s.name).sort(), 'the original still lists its snapshots');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, a)).removed, [], 'old-id snapshots are never pruned');
      assert.deepEqual((await manager.listSnapshots(shared, copy)).map((s) => s.name), [], 'still none once both are upgraded');
    });

    test('a cp -r copy of an old UUID-only project opened after the original lists none of its snapshots', async () => {
      const { a, shared, originals, copy } = await legacyOriginalAndCopy();
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
    });

    test('a same-name copy of an old UUID-only project in another folder never prunes the original snapshots', async () => {
      const { a, shared, originals } = await legacyOriginalAndCopy();
      await fsp.mkdir(path.join(tmp, 'elsewhere'));
      const copy = path.join(tmp, 'elsewhere', 'Novel A');
      await fsp.cp(a, copy, { recursive: true });
      await createBackupManager({ fs, path, now: () => new Date(2026, 0, 1, 0, 5, 0) })
        .createSnapshot(copy, shared, { automatic: true });
      assert.equal((await manager.pruneSnapshots(shared, 0, copy)).removed.length, 1, 'only the copy\'s own snapshot');
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
    });

    test('a copy that already took the old id (v1.26.2-v1.26.15) never prunes the original snapshots', async () => {
      const { a, shared, originals, id, copy } = await legacyOriginalAndCopy();
      // What those versions wrote when the copy was opened first: the old id bound to the copy.
      await fsp.writeFile(path.join(copy, '.ensemble-backup', 'identity'), `${id}\n${await fsp.realpath(copy)}\n`);
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
    });

    for (const [label, copyName] of [['same name', 'Novel A'], ['another name', 'Novel A cp']]) {
      for (const order of ['copy first', 'original first']) {
        test(`a cp -r copy (${label}) of an old UUID-only project in another folder lists none of the original snapshots, ${order}`, async () => {
          const a = await makeProject(path.join(tmp, 'Novel A'));
          const shared = path.join(tmp, 'shared');
          const originals = await threeAutoSnapshots(a, shared);
          await makeLegacy(a);
          // Real copies come later than the snapshots: keep them out of the same clock tick.
          await new Promise((resolve) => setTimeout(resolve, 30));
          await fsp.mkdir(path.join(tmp, 'elsewhere'));
          const copy = path.join(tmp, 'elsewhere', copyName);
          await fsp.cp(a, copy, { recursive: true });
          if (order === 'original first') assert.equal((await manager.listSnapshots(shared, a)).length, 3);

          assert.deepEqual((await manager.listSnapshots(shared, copy)).map((s) => s.name), [], 'the copy lists none');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, [], 'pruning the copy removes none');
          for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
          const listedA = (await createBackupManager({ fs, path }).listSnapshots(shared, a)).map((s) => s.name).sort();
          assert.deepEqual(listedA, originals.map((s) => s.name).sort(), 'the original still lists its snapshots');
          assert.deepEqual((await manager.listSnapshots(shared, copy)).map((s) => s.name), [], 'still none afterwards');
        });
      }
    }

    test('an old UUID-only project renamed or moved keeps its snapshots listed and retained', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = (await threeAutoSnapshots(a, shared)).map((s) => s.name).sort();
      await makeLegacy(a);
      const renamed = path.join(tmp, 'Novel A (final)');
      await fsp.rename(a, renamed);
      assert.deepEqual((await manager.listSnapshots(shared, renamed)).map((s) => s.name).sort(), originals);
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, renamed)).removed, []);

      await fsp.mkdir(path.join(tmp, 'elsewhere'));
      const moved = path.join(tmp, 'elsewhere', 'Novel A (final)');
      await fsp.rename(renamed, moved);
      const listed = await createBackupManager({ fs, path }).listSnapshots(shared, moved);
      assert.deepEqual(listed.map((s) => s.name).sort(), originals);
      assert.ok(listed.every((s) => !s.legacy), 'listed as the project\'s own snapshots');
      for (const name of originals) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    /**
     * `mv` to another file system: the folder is recreated (new creation time) and
     * file times are kept.
     */
    async function moveAcrossDisks(from, to) {
      await fsp.cp(from, to, { recursive: true, preserveTimestamps: true });
      await fsp.rm(from, { recursive: true, force: true });
    }

    for (const [label, movedName] of [['same name', 'Novel A'], ['renamed', 'Novel A (final)']]) {
      test(`an old UUID-only project moved to another disk (${label}) keeps its snapshots listed`, async () => {
        const a = await makeProject(path.join(tmp, 'Novel A'));
        const shared = path.join(tmp, 'shared');
        const originals = (await threeAutoSnapshots(a, shared)).map((s) => s.name).sort();
        await makeLegacy(a); // rewritten after the snapshots, like the reviewer's probe
        await new Promise((resolve) => setTimeout(resolve, 30));
        await fsp.mkdir(path.join(tmp, 'other-disk'));
        const moved = path.join(tmp, 'other-disk', movedName);
        await moveAcrossDisks(a, moved);

        assert.deepEqual((await manager.listSnapshots(shared, moved)).map((s) => s.name).sort(), originals);
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, moved)).removed, []);
        for (const name of originals) assert.ok(fs.existsSync(path.join(shared, name)), `${name} must survive`);
        assert.deepEqual((await createBackupManager({ fs, path }).listSnapshots(shared, moved)).map((s) => s.name).sort(),
          originals, 'still listed once upgraded');
      });
    }

    test('an old UUID-only project upgraded and then moved to another disk keeps its snapshots listed', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = (await threeAutoSnapshots(a, shared)).map((s) => s.name).sort();
      await makeLegacy(a);
      assert.deepEqual((await manager.listSnapshots(shared, a)).map((s) => s.name).sort(), originals);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fsp.mkdir(path.join(tmp, 'other-disk'));
      const moved = path.join(tmp, 'other-disk', 'Novel A');
      await moveAcrossDisks(a, moved);
      assert.deepEqual((await createBackupManager({ fs, path }).listSnapshots(shared, moved)).map((s) => s.name).sort(), originals);
    });

    test('a project upgraded by v1.26.16-v1.26.27 and then moved to another disk keeps its snapshots listed', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = (await threeAutoSnapshots(a, shared)).map((s) => s.name).sort();
      await makeLegacy(a);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual((await manager.listSnapshots(shared, a)).map((s) => s.name).sort(), originals);
      // Those versions recorded no inherited time.
      await fsp.rm(path.join(a, '.ensemble-backup', 'identity-inherited-since'), { force: true });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fsp.mkdir(path.join(tmp, 'other-disk'));
      const moved = path.join(tmp, 'other-disk', 'Novel A');
      await moveAcrossDisks(a, moved);
      assert.deepEqual((await createBackupManager({ fs, path }).listSnapshots(shared, moved)).map((s) => s.name).sort(), originals);
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, moved)).removed, []);
    });

    test('a cp -r copy in another folder upgraded by v1.26.16-v1.26.27 still lists none of the original snapshots', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = await threeAutoSnapshots(a, shared);
      await makeLegacy(a);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fsp.mkdir(path.join(tmp, 'elsewhere'));
      const copy = path.join(tmp, 'elsewhere', 'Novel A');
      await fsp.cp(a, copy, { recursive: true });
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
      await fsp.rm(path.join(copy, '.ensemble-backup', 'identity-inherited-since'), { force: true });
      assert.deepEqual(await createBackupManager({ fs, path }).listSnapshots(shared, copy), []);
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      for (const snapshot of originals) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
    });

    for (const legacy of [true, false]) {
      const kind = legacy ? 'an upgraded old UUID-only project' : 'a project';
      test(`a same-name cp -r copy of ${kind} in another folder lists none of the original snapshots`, async () => {
        const a = await makeProject(path.join(tmp, 'Novel A'));
        const shared = path.join(tmp, 'shared');
        const originals = (await threeAutoSnapshots(a, shared)).map((s) => s.name).sort();
        if (legacy) await makeLegacy(a);
        // The original is opened (and, if old, upgraded) before it is copied.
        assert.deepEqual((await manager.listSnapshots(shared, a)).map((s) => s.name).sort(), originals);
        await new Promise((resolve) => setTimeout(resolve, 30));
        await fsp.mkdir(path.join(tmp, 'elsewhere'));
        const copy = path.join(tmp, 'elsewhere', 'Novel A');
        await fsp.cp(a, copy, { recursive: true });

        assert.deepEqual(await manager.listSnapshots(shared, copy), [], 'the copy lists none, not even restore-only');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, [], 'pruning the copy removes none');
        const own = await createBackupManager({ fs, path, now: () => new Date(2026, 0, 1, 0, 5, 0) })
          .createSnapshot(copy, shared, { automatic: true });
        assert.deepEqual((await createBackupManager({ fs, path }).listSnapshots(shared, copy)).map((s) => s.name), [own.name],
          'the copy lists only its own snapshot');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, [own.name]);
        for (const name of originals) assert.ok(fs.existsSync(path.join(shared, name)), `${name} must survive`);
        assert.deepEqual((await manager.listSnapshots(shared, a)).map((s) => s.name).sort(), originals);
      });
    }

    test('a same-name copy in another folder opened by v1.26.2-v1.26.30 lists none of the original snapshots', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const originals = (await threeAutoSnapshots(a, shared)).map((s) => s.name).sort();
      await makeLegacy(a);
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fsp.mkdir(path.join(tmp, 'elsewhere'));
      const copy = path.join(tmp, 'elsewhere', 'Novel A');
      await fsp.cp(a, copy, { recursive: true });
      assert.deepEqual(await manager.listSnapshots(shared, copy), []);
      // Those versions gave the copy a fresh identity and recorded nothing else.
      await fsp.rm(path.join(copy, '.ensemble-backup', 'identity-foreign'));
      assert.deepEqual(await createBackupManager({ fs, path }).listSnapshots(shared, copy), []);
      // A copy of that copy, elsewhere again, lists none either.
      await fsp.mkdir(path.join(tmp, 'third'));
      const second = path.join(tmp, 'third', 'Novel A');
      await fsp.cp(copy, second, { recursive: true });
      assert.deepEqual(await manager.listSnapshots(shared, second), []);
      assert.deepEqual((await manager.listSnapshots(shared, a)).map((s) => s.name).sort(), originals);
    });

    test('concurrent calls on a copy agree on one new identity', async () => {
      const a = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      await threeAutoSnapshots(a, shared);
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(a, copy, { recursive: true });
      const [snapshot] = await Promise.all([
        manager.createSnapshot(copy, shared),
        manager.listSnapshots(shared, copy),
        manager.pruneSnapshots(shared, 0, copy),
      ]);
      assert.deepEqual((await manager.listSnapshots(shared, copy)).map((s) => s.name), [snapshot.name]);
      assert.equal((await manager.listSnapshots(shared, a)).length, 3);
    });
  });

  describe('snapshots taken while the project was read-only', () => {
    const posixOnly = process.platform === 'win32' || process.getuid?.() === 0;
    const locked = [];
    const lock = async (dir) => { await fsp.chmod(dir, 0o555); locked.push(dir); };
    const unlock = async (dir) => { await fsp.chmod(dir, 0o755); };
    /** Linux needs write access on a folder to move it (its `..` entry changes): it stays read-only otherwise. */
    const moveLocked = async (from, to) => { await unlock(from); await fsp.rename(from, to); await lock(to); };
    afterEach(async () => {
      for (const dir of locked.splice(0)) await fsp.chmod(dir, 0o755).catch(() => {});
    });

    const pathIdOf = (realParent, name) => {
      const hex = createHash('sha256').update(path.join(realParent, name)).digest('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    };
    const snapshotId = (name) => name.match(/--([0-9a-f-]{36})--/)[1];
    const mintedShape = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

    /** chmod 555 project: 2 manual + 1 automatic snapshot into a writable folder (the card's probe). */
    async function readOnlySnapshots(project, shared) {
      // A project exists for a while before its snapshots (file times are stamped from a
      // coarse clock: a folder changed within the same tick can read as later than the zip).
      await new Promise((resolve) => setTimeout(resolve, 20));
      await lock(project);
      const made = [];
      for (let i = 0; i < 3; i += 1) {
        const at = createBackupManager({ fs, path, now: () => new Date(2026, 0, 1, 0, 0, i) });
        made.push(await at.createSnapshot(project, shared, { automatic: i === 2 }));
      }
      assert.equal(fs.existsSync(path.join(project, '.ensemble-backup')), false, 'the project stayed read-only');
      assert.equal((await manager.listSnapshots(shared, project)).length, 3);
      return made;
    }

    test('making the project writable keeps them listed as its own and never prunes them', { skip: posixOnly }, async () => {
      const project = await makeProject(path.join(tmp, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const earlier = await readOnlySnapshots(project, shared);
      await unlock(project);
      const own = await createBackupManager({ fs, path, now: () => new Date(2026, 0, 2) })
        .createSnapshot(project, shared, { automatic: true });

      const listed = await createBackupManager({ fs, path }).listSnapshots(shared, project);
      assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own].map((s) => s.name).sort(),
        'snapshots from the read-only period must stay listed');
      assert.ok(listed.every((s) => !s.legacy), 'they are listed as this project\'s snapshots');
      const pruned = await manager.pruneSnapshots(shared, 0, project);
      assert.deepEqual(pruned.removed, [own.name], 'retention only removes snapshots of the current id');
      for (const snapshot of earlier) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
      assert.equal((await manager.listSnapshots(shared, project)).length, 3);
    });

    test('moving or renaming the read-only project keeps them listed, restore-only', { skip: posixOnly }, async () => {
      // A path whose hash looks minted (1 in 64) gets an adjusted id (covered below): avoid one here.
      let parent;
      for (let i = 0; !parent || mintedShape(pathIdOf(await fsp.realpath(parent), 'Novel A')); i += 1) {
        parent = path.join(tmp, `p${i}`);
        await fsp.mkdir(parent);
      }
      const project = await makeProject(path.join(parent, 'Novel A'));
      const realParent = await fsp.realpath(parent);
      await fsp.writeFile(path.join(project, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A', settings: {} }));
      const shared = path.join(tmp, 'shared');
      const earlier = (await readOnlySnapshots(project, shared)).map((s) => s.name).sort();
      assert.ok(earlier.every((name) => name.includes(pathIdOf(realParent, 'Novel A'))), 'snapshots carry the path-derived id');

      const moved = path.join(tmp, 'elsewhere', 'Novel A');
      await fsp.mkdir(path.dirname(moved));
      await moveLocked(project, moved);
      let listed = await manager.listSnapshots(shared, moved);
      assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'a moved read-only project keeps its snapshots listed');
      assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'));

      const renamed = path.join(tmp, 'elsewhere', 'Novel A (final)');
      await moveLocked(moved, renamed);
      listed = await manager.listSnapshots(shared, renamed);
      assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'a renamed read-only project keeps its snapshots listed');
      assert.ok(listed.every((s) => s.legacy));

      await unlock(renamed);
      const own = await manager.createSnapshot(renamed, shared, { automatic: true });
      listed = await manager.listSnapshots(shared, renamed);
      assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort());
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, renamed)).removed, [own.name],
        'restore-only snapshots are never pruned');
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
      const restored = await manager.restoreSnapshot(path.join(shared, earlier[0]), path.join(tmp, 'restored'));
      assert.equal(await fsp.readFile(path.join(restored.folderPath, 'characters', 'mara.md'), 'utf8'), '# Mara');
    });

    /** A parent folder under `tmp` where `<parent>/<name>` hashes to a minted-looking (v4) id, as about 1 in 64 paths do. */
    async function mintedShapedParent(name) {
      for (let i = 0; ; i += 1) {
        const parent = path.join(tmp, `m${i}`);
        await fsp.mkdir(parent, { recursive: true });
        if (mintedShape(pathIdOf(await fsp.realpath(parent), name))) return parent;
      }
    }

    test('a read-only project whose path hashes to a UUID-looking id keeps them listed after a move or rename', { skip: posixOnly }, async () => {
      const parent = await mintedShapedParent('Novel A');
      const project = await makeProject(path.join(parent, 'Novel A'));
      await fsp.writeFile(path.join(project, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A', settings: {} }));
      const shared = path.join(tmp, 'shared');
      const earlier = (await readOnlySnapshots(project, shared)).map((s) => s.name).sort();

      const renamed = path.join(tmp, 'elsewhere', 'Novel A (final)');
      await fsp.mkdir(path.dirname(renamed));
      await moveLocked(project, renamed);
      let listed = await manager.listSnapshots(shared, renamed);
      assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'a renamed read-only project keeps its snapshots listed');
      assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'));
      const moved = path.join(tmp, 'Novel A');
      await moveLocked(renamed, moved);
      listed = await manager.listSnapshots(shared, moved);
      assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'a moved read-only project keeps its snapshots listed');

      await unlock(moved);
      const own = await manager.createSnapshot(moved, shared, { automatic: true });
      assert.deepEqual((await manager.listSnapshots(shared, moved)).map((s) => s.name).sort(), [...earlier, own.name].sort());
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, moved)).removed, [own.name],
        'restore-only snapshots are never pruned');
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
      assert.ok(earlier.every((name) => !mintedShape(snapshotId(name))), 'path-derived ids never look minted');
    });

    test('snapshots with the older UUID-looking path id stay this project\'s', { skip: posixOnly }, async () => {
      // Taken by v1.22.11-v1.26.16, which used the raw hash as the path-derived id.
      const parent = await mintedShapedParent('Novel A');
      const project = await makeProject(path.join(parent, 'Novel A'));
      const shared = path.join(tmp, 'shared');
      const rawId = pathIdOf(await fsp.realpath(parent), 'Novel A');
      const earlier = [];
      for (const snapshot of await readOnlySnapshots(project, shared)) {
        const old = path.join(shared, snapshot.name.replace(snapshotId(snapshot.name), rawId));
        await fsp.rename(snapshot.path, old);
        earlier.push(path.basename(old));
      }
      earlier.sort();
      let listed = await manager.listSnapshots(shared, project);
      assert.deepEqual(listed.map((s) => s.name).sort(), earlier);
      assert.ok(listed.every((s) => !s.legacy), 'still read-only: listed as this project\'s');

      await unlock(project);
      const own = await manager.createSnapshot(project, shared, { automatic: true });
      listed = await manager.listSnapshots(shared, project);
      assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort());
      assert.ok(listed.every((s) => !s.legacy), 'writable: the older id is recorded as an alias');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, project)).removed, [own.name]);
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    /** v1.22.11-v1.26.16 snapshots of a read-only project whose raw path hash looks like a minted UUID. */
    async function olderMintedLookingSnapshots(name, { projectName } = {}) {
      const parent = await mintedShapedParent(name);
      const project = await makeProject(path.join(parent, name));
      if (projectName) await fsp.writeFile(path.join(project, 'ensemble.json'), JSON.stringify({ projectName, settings: {} }));
      const shared = path.join(tmp, 'shared');
      const rawId = pathIdOf(await fsp.realpath(parent), name);
      assert.ok(mintedShape(rawId));
      const earlier = [];
      for (const snapshot of await readOnlySnapshots(project, shared)) {
        const old = path.join(shared, snapshot.name.replace(snapshotId(snapshot.name), rawId));
        await fsp.rename(snapshot.path, old);
        earlier.push(path.basename(old));
      }
      return { parent, project, shared, earlier: earlier.sort() };
    }

    test('older UUID-looking path ids stay listed after renaming the read-only project (reviewer probe)', { skip: posixOnly }, async () => {
      for (const projectName of ['Novel A', undefined]) {
        const { parent, project, shared, earlier } = await olderMintedLookingSnapshots('Novel A', { projectName });
        assert.equal((await manager.listSnapshots(shared, project)).length, 3, 'listed while read-only');

        const renamed = path.join(parent, 'Novel A (final)');
        await moveLocked(project, renamed);
        let listed = await manager.listSnapshots(shared, renamed);
        assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed after a read-only rename');
        assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'), 'restore-only');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, renamed)).removed, []);
        if (projectName) {
          const sibling = await makeProject(path.join(parent, 'Novel B'));
          await fsp.writeFile(path.join(sibling, 'ensemble.json'), JSON.stringify({ projectName: 'Novel B', settings: {} }));
          assert.deepEqual(await manager.listSnapshots(shared, sibling), [], 'another project in that folder lists none');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, sibling)).removed, []);
        }

        await unlock(renamed);
        const own = await manager.createSnapshot(renamed, shared, { automatic: true });
        listed = await manager.listSnapshots(shared, renamed);
        assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort(), 'still listed once writable');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, renamed)).removed, [own.name],
          'restore-only snapshots are never pruned');
        for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        await fsp.rm(shared, { recursive: true });
        await fsp.rm(parent, { recursive: true });
      }
    });

    test('older UUID-looking path ids are not claimed by a renamed copy while the original folder exists', { skip: posixOnly }, async () => {
      const { parent, project, shared, earlier } = await olderMintedLookingSnapshots('Novel A', { projectName: 'Novel A' });
      const copy = path.join(parent, 'Novel A cp');
      await unlock(project);
      await fsp.cp(project, copy, { recursive: true });
      await lock(project);
      assert.deepEqual(await manager.listSnapshots(shared, copy), [], 'the original still lists them');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      assert.deepEqual((await manager.listSnapshots(shared, project)).map((s) => s.name).sort(), earlier);
    });

    test('older UUID-looking path ids stay listed after moving and renaming the read-only project at once (reviewer probe)', { skip: posixOnly }, async () => {
      for (const projectName of ['Novel A', undefined]) {
        const { parent, project, shared, earlier } = await olderMintedLookingSnapshots('Novel A', { projectName });
        assert.equal((await manager.listSnapshots(shared, project)).length, 3, 'listed while read-only');

        const target = path.join(tmp, 'elsewhere', 'deeper', 'Novel A (final)');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await moveLocked(project, target);
        let listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
        assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed after a read-only move and rename');
        assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'), 'restore-only');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, []);
        const other = await makeProject(path.join(tmp, 'elsewhere', 'Novel B'));
        await fsp.writeFile(path.join(other, 'ensemble.json'), JSON.stringify({ projectName: 'Novel B', settings: {} }));
        if (projectName) assert.deepEqual(await manager.listSnapshots(shared, other), [], 'another project lists none');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, other)).removed, []);

        await unlock(target);
        const own = await manager.createSnapshot(target, shared, { automatic: true });
        listed = await manager.listSnapshots(shared, target);
        assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort(), 'still listed once writable');
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, [own.name],
          'restore-only snapshots are never pruned');
        for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        for (const dir of [shared, parent, path.join(tmp, 'elsewhere')]) await fsp.rm(dir, { recursive: true });
      }
    });

    test('older UUID-looking path ids are not claimed by a copy moved and renamed elsewhere while the original exists', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await olderMintedLookingSnapshots('Novel A', { projectName: 'Novel A' });
      const copy = path.join(tmp, 'elsewhere', 'Novel A cp');
      await fsp.mkdir(path.dirname(copy));
      await unlock(project);
      await fsp.cp(project, copy, { recursive: true });
      await lock(project);
      assert.deepEqual(await manager.listSnapshots(shared, copy), [], 'the original still lists them');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      assert.deepEqual((await manager.listSnapshots(shared, project)).map((s) => s.name).sort(), earlier);
    });

    /**
     * v1.22.11-v1.26.16 snapshots (2, UUID-looking path id) of a read-only project deep in
     * an unrelated branch: too far from where it goes for the nearby folder search.
     */
    async function distantOlderSnapshots(projectName, { beforeSnapshots } = {}) {
      const deep = path.join(tmp, 'old-unrelated', 'a', 'b', 'c', 'd', 'e', 'f', 'g');
      await fsp.mkdir(deep, { recursive: true });
      let base;
      for (let i = 0; !base || !mintedShape(pathIdOf(await fsp.realpath(base), 'Novel A')); i += 1) {
        base = path.join(deep, `m${i}`);
        await fsp.mkdir(base);
      }
      const project = await makeProject(path.join(base, 'Novel A'));
      if (projectName) await fsp.writeFile(path.join(project, 'ensemble.json'), JSON.stringify({ projectName, settings: {} }));
      const shared = path.join(tmp, 'shared');
      const rawId = pathIdOf(await fsp.realpath(base), 'Novel A');
      if (beforeSnapshots) await beforeSnapshots(project);
      const made = await readOnlySnapshots(project, shared);
      const earlier = [];
      for (const snapshot of made.slice(0, 2)) {
        const old = path.join(shared, snapshot.name.replace(snapshotId(snapshot.name), rawId));
        await fsp.rename(snapshot.path, old);
        earlier.push(path.basename(old));
      }
      await fsp.rm(made[2].path);
      assert.equal((await manager.listSnapshots(shared, project)).length, 2, 'listed while read-only');
      return { project, shared, earlier: earlier.sort() };
    }

    for (const oldParent of ['kept', 'deleted']) {
      test(`older UUID-looking path ids stay listed after a distant move and rename, old parent ${oldParent} (reviewer probe)`, { skip: posixOnly }, async () => {
        for (const projectName of ['Novel A', undefined]) {
          const { project, shared, earlier } = await distantOlderSnapshots(projectName);
          const target = path.join(tmp, 'new-unrelated', 'h', 'i', 'j', 'k', 'l', 'Novel A (final)');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await moveLocked(project, target);
          if (oldParent === 'deleted') await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
          let listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed after a distant read-only move and rename');
          assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'), 'restore-only');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, []);

          await unlock(target);
          const own = await manager.createSnapshot(target, shared, { automatic: true });
          listed = await manager.listSnapshots(shared, target);
          assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort(), 'still listed once writable');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, [own.name],
            'restore-only snapshots are never pruned');
          for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
          for (const dir of [shared, path.join(tmp, 'old-unrelated'), path.join(tmp, 'new-unrelated')]) {
            await fsp.rm(dir, { recursive: true, force: true });
          }
        }
      });
    }

    /** Every file under `root` (state folder included), like `find root -type f`. */
    async function everyFile(root) {
      const found = [];
      for (const entry of await fsp.readdir(root, { withFileTypes: true, recursive: true })) {
        if (entry.isFile()) found.push(path.join(entry.parentPath ?? entry.path, entry.name));
      }
      return found;
    }

    for (const change of ['touch', 'edit']) {
      for (const listedBefore of [true, false]) {
        test(`older UUID-looking path ids stay listed after a distant move and rename once writable, after ${change === 'touch' ? 'touching' : 'editing'} every file${listedBefore ? '' : ' (no listing before)'} (reviewer probe)`, { skip: posixOnly }, async () => {
          const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
          const target = path.join(tmp, 'new-unrelated', 'h', 'i', 'j', 'k', 'l', 'Novel A (final)');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await moveLocked(project, target);
          assert.deepEqual((await manager.listSnapshots(shared, target)).map((s) => s.name).sort(), earlier);

          await unlock(target);
          const own = await createBackupManager({ fs, path }).createSnapshot(target, shared, { automatic: true });
          if (listedBefore) {
            const listed = await manager.listSnapshots(shared, target);
            assert.equal(listed.length, 3, 'listed once writable');
            assert.equal(listed.filter((s) => s.legacy).length, 2, 'historical once writable');
          }

          // `find . -type f -exec touch {} +` (no content change), or an edit of every file.
          const later = new Date(Date.now() + 5000);
          const files = await everyFile(target);
          assert.ok(files.length >= 5);
          for (const file of files) {
            if (change === 'edit') await fsp.appendFile(file, '\n');
            await fsp.utimes(file, later, later);
          }

          const fresh = createBackupManager({ fs, path });
          const listed = await fresh.listSnapshots(shared, target);
          assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort(), `listed after ${change}`);
          const historical = listed.filter((s) => s.legacy);
          assert.deepEqual(historical.map((s) => s.name).sort(), earlier, 'historical stay listed');
          assert.ok(historical.every((s) => s.legacyProjectName === 'Novel A'));
          assert.deepEqual((await fresh.pruneSnapshots(shared, 10, target)).removed, [], 'prune removes none');
          assert.deepEqual((await fresh.pruneSnapshots(shared, 0, target)).removed, [own.name],
            'restore-only snapshots are never pruned');
          assert.deepEqual((await fresh.listSnapshots(shared, target)).map((s) => s.name).sort(), earlier);
          for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        });
      }
    }

    /** `find . -type f -exec touch {} +`, an in-place edit of every file, or an editor that replaces each file. */
    async function changeEveryFile(root, change) {
      const later = new Date(Date.now() + 5000);
      const files = await everyFile(root);
      assert.ok(files.length >= 5);
      for (const file of files) {
        if (change === 'edit') await fsp.appendFile(file, '\n');
        if (change === 'replace') {
          const content = await fsp.readFile(file);
          await fsp.writeFile(`${file}.tmp.1`, Buffer.concat([content, Buffer.from('\n')]));
          await fsp.rename(`${file}.tmp.1`, file);
        }
        await fsp.utimes(file, later, later);
      }
    }

    for (const oldParent of ['kept', 'deleted']) {
      for (const [change, listFirst] of [['touch', true], ['edit', true], ['replace', true], ['touch', false], ['edit', false]]) {
        test(`older UUID-looking path ids stay listed when every file is ${change === 'touch' ? 'touched' : change === 'edit' ? 'edited' : 'replaced'} right after a distant move and rename, writable destination, ${listFirst ? 'listed' : 'snapshot'} first, old parent ${oldParent} (reviewer probe)`, { skip: posixOnly }, async () => {
          const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
          const target = path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z', 'Renamed');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await unlock(project);
          await fsp.rename(project, target);
          if (oldParent === 'deleted') await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
          // Before Ensemble lists or snapshots the project at its new place.
          await changeEveryFile(target, change);

          const fresh = createBackupManager({ fs, path });
          let listed;
          if (listFirst) {
            listed = await fresh.listSnapshots(shared, target);
            assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed before the first snapshot');
            assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'), 'restore-only');
          }
          const own = await fresh.createSnapshot(target, shared, { automatic: true });
          listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.equal(listed.length, 3, 'listed 3 once it has its own snapshot');
          assert.deepEqual(listed.filter((s) => s.legacy).map((s) => s.name).sort(), earlier, 'historical 2');
          assert.deepEqual((await fresh.pruneSnapshots(shared, 10, target)).removed, [], 'prune removes none');
          assert.deepEqual((await fresh.pruneSnapshots(shared, 0, target)).removed, [own.name],
            'restore-only snapshots are never pruned');
          for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        });
      }

      for (const change of ['touch', 'edit']) {
        test(`older UUID-looking path ids stay listed when every file is ${change === 'touch' ? 'touched' : 'edited'} right after a distant move and rename while still read-only, old parent ${oldParent} (reviewer probe)`, { skip: posixOnly }, async () => {
          const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
          const target = path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z', 'Renamed');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await moveLocked(project, target);
          if (oldParent === 'deleted') await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
          await changeEveryFile(target, change);

          let listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed while still read-only');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, []);

          await unlock(target);
          const own = await createBackupManager({ fs, path }).createSnapshot(target, shared, { automatic: true });
          listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.equal(listed.length, 3, 'listed 3 once writable with its own snapshot');
          assert.deepEqual(listed.filter((s) => s.legacy).map((s) => s.name).sort(), earlier, 'historical 2');
          assert.deepEqual((await manager.pruneSnapshots(shared, 10, target)).removed, [], 'prune removes none');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, [own.name]);
          for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        });
      }
    }

    test('a distant copy made later and then touched or edited still lists none of them', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const far = path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z');
      await fsp.mkdir(far, { recursive: true });
      await unlock(project);
      for (const [name, change] of [['Copy touched', 'touch'], ['Copy edited', 'edit']]) {
        for (const preserveTimestamps of [false, true]) {
          const copy = path.join(far, `${name}${preserveTimestamps ? ' -a' : ''}`);
          await fsp.cp(project, copy, { recursive: true, preserveTimestamps });
          await changeEveryFile(copy, change);
          assert.deepEqual(await manager.listSnapshots(shared, copy), [], `${path.basename(copy)} lists none`);
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
        }
      }
      await lock(project);
      assert.deepEqual((await manager.listSnapshots(shared, project)).map((s) => s.name).sort(), earlier);
    });

    /**
     * `mv` to another file system (tmpfs /tmp -> /dev/shm, btrfs / -> /home): every file is
     * copied with its modification time and the source removed, so the moved folder and
     * files get new inodes and creation times (later than every snapshot). Modelled with a
     * time-preserving copy plus delete, so it runs on a single disk.
     */
    async function moveAcrossDisks(from, to, { locked = false } = {}) {
      await unlock(from);
      const before = await fsp.stat(path.join(from, 'characters', 'mara.md'));
      await fsp.cp(from, to, { recursive: true, preserveTimestamps: true });
      // Like mv (coreutils copies with --preserve=timestamps), folders keep their times too;
      // fs.cp only keeps file times. Deepest first, so filling a folder never resets its parent.
      const folders = (await fsp.readdir(from, { withFileTypes: true, recursive: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.relative(from, path.join(entry.parentPath ?? entry.path, entry.name)))
        .sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
      for (const rel of [...folders, '']) {
        const stats = await fsp.stat(path.join(from, rel));
        await fsp.utimes(path.join(to, rel), stats.atime, stats.mtime);
      }
      await fsp.rm(from, { recursive: true });
      const after = await fsp.stat(path.join(to, 'characters', 'mara.md'));
      assert.ok(Math.abs(after.mtimeMs - before.mtimeMs) < 1, 'mv keeps modification times');
      assert.ok(after.ino !== before.ino || after.birthtimeMs > before.birthtimeMs, 'new inodes or creation times');
      if (locked) await lock(to);
    }

    for (const oldParent of ['kept', 'deleted']) {
      for (const change of ['touch', 'edit']) {
        test(`older UUID-looking path ids stay listed after a move to another disk and rename, every file ${change === 'touch' ? 'touched' : 'edited'}, writable destination, old parent ${oldParent} (reviewer probe)`, { skip: posixOnly }, async () => {
          const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
          await new Promise((resolve) => setTimeout(resolve, 30));
          const target = path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z', 'Renamed');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await moveAcrossDisks(project, target);
          if (oldParent === 'deleted') await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
          await changeEveryFile(target, change);

          let listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed before the first snapshot');
          assert.ok(listed.every((s) => s.legacy && s.legacyProjectName === 'Novel A'), 'restore-only');
          const own = await createBackupManager({ fs, path }).createSnapshot(target, shared, { automatic: true });
          listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.equal(listed.length, 3, 'listed 3 once it has its own snapshot');
          assert.deepEqual(listed.filter((s) => s.legacy).map((s) => s.name).sort(), earlier, 'historical 2');
          assert.deepEqual((await manager.pruneSnapshots(shared, 10, target)).removed, [], 'prune removes none');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, [own.name],
            'restore-only snapshots are never pruned');
          for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        });

        test(`older UUID-looking path ids stay listed after a move to another disk and rename, every file ${change === 'touch' ? 'touched' : 'edited'} while still read-only, old parent ${oldParent} (reviewer probe)`, { skip: posixOnly }, async () => {
          const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
          await new Promise((resolve) => setTimeout(resolve, 30));
          const target = path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z', 'Renamed');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await moveAcrossDisks(project, target, { locked: true });
          if (oldParent === 'deleted') await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
          await changeEveryFile(target, change);

          let listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'listed while still read-only');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, []);

          await unlock(target);
          // Touched or edited again once writable, before its first snapshot there.
          await changeEveryFile(target, change);
          const own = await createBackupManager({ fs, path }).createSnapshot(target, shared, { automatic: true });
          listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.equal(listed.length, 3, 'listed 3 once writable with its own snapshot');
          assert.deepEqual(listed.filter((s) => s.legacy).map((s) => s.name).sort(), earlier, 'historical 2');
          await changeEveryFile(target, change);
          listed = await createBackupManager({ fs, path }).listSnapshots(shared, target);
          assert.equal(listed.length, 3, 'still 3 after touching or editing every file again');
          assert.deepEqual((await manager.pruneSnapshots(shared, 10, target)).removed, [], 'prune removes none');
          assert.deepEqual((await manager.pruneSnapshots(shared, 0, target)).removed, [own.name]);
          for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
        });
      }
    }

    /**
     * Two far projects that exist before the original's read-only snapshots: a plain cp -r
     * copy, and an unrelated project with the same folder name, projectName and files.
     */
    async function otherProjectsBefore() {
      const others = {};
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A', {
        beforeSnapshots: async (original) => {
          const far = path.join(tmp, 'far-away', 'p', 'q', 'r', 's', 't');
          await fsp.mkdir(far, { recursive: true });
          others.copy = path.join(far, 'Novel A cp');
          await fsp.cp(original, others.copy, { recursive: true });
          others.unrelated = await makeProject(path.join(far, 'other', 'Novel A'));
          await fsp.writeFile(path.join(others.unrelated, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A', settings: {} }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
      });
      return { project, shared, earlier, ...others };
    }

    test('an earlier far copy and an unrelated same-name project list none of the original\'s snapshots (reviewer probe)', { skip: posixOnly }, async () => {
      const { project, shared, earlier, copy, unrelated } = await otherProjectsBefore();
      for (const other of [copy, unrelated]) {
        const label = other === copy ? 'the earlier cp -r copy' : 'the unrelated project';
        assert.deepEqual(await createBackupManager({ fs, path }).listSnapshots(shared, other), [], `${label} lists none`);
        assert.deepEqual((await manager.pruneSnapshots(shared, 0, other)).removed, []);
        // Read-only, then touched: still none.
        await lock(other);
        await changeEveryFile(other, 'touch');
        assert.deepEqual(await createBackupManager({ fs, path }).listSnapshots(shared, other), [], `${label} lists none while read-only`);
        await unlock(other);
      }
      assert.deepEqual((await manager.listSnapshots(shared, project)).map((s) => s.name).sort(), earlier, 'the original keeps them');
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    test('the original lists none of an earlier far copy\'s or an unrelated same-name project\'s snapshots (reviewer probe)', { skip: posixOnly }, async () => {
      const { project, shared, earlier, copy, unrelated } = await otherProjectsBefore();
      const theirs = [];
      for (const other of [copy, unrelated]) {
        // A writable one (UUID identity), then the same one read-only (path-derived id).
        theirs.push((await createBackupManager({ fs, path }).createSnapshot(other, shared)).name);
        const readOnly = `${other} ro`;
        await fsp.cp(other, readOnly, { recursive: true, preserveTimestamps: true });
        await fsp.rm(path.join(readOnly, '.ensemble-backup'), { recursive: true });
        await lock(readOnly);
        theirs.push((await createBackupManager({ fs, path }).createSnapshot(readOnly, shared)).name);
        assert.deepEqual((await manager.listSnapshots(shared, other)).map((s) => s.name), [theirs.at(-2)]);
      }
      let listed = await createBackupManager({ fs, path }).listSnapshots(shared, project);
      assert.deepEqual(listed.map((s) => s.name).sort(), earlier, 'the original lists only its own');
      await unlock(project);
      const own = await createBackupManager({ fs, path }).createSnapshot(project, shared, { automatic: true });
      listed = await createBackupManager({ fs, path }).listSnapshots(shared, project);
      assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort(), 'still only its own once writable');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, project)).removed, [own.name]);
      for (const name of theirs) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    for (const firstLister of ['others', 'moved']) {
      test(`after the original moves to another disk, an earlier far copy and an unrelated same-name project still list none (${firstLister} listed first)`, { skip: posixOnly }, async () => {
        const { project, shared, earlier, copy, unrelated } = await otherProjectsBefore();
        await new Promise((resolve) => setTimeout(resolve, 30));
        const target = path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z', 'Renamed');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await moveAcrossDisks(project, target);
        await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
        await changeEveryFile(target, 'edit');
        const listOthers = async () => {
          for (const other of [copy, unrelated]) {
            assert.deepEqual(await createBackupManager({ fs, path }).listSnapshots(shared, other), [], `${path.basename(path.dirname(other))}/${path.basename(other)} lists none`);
            assert.deepEqual((await manager.pruneSnapshots(shared, 0, other)).removed, []);
          }
        };
        if (firstLister === 'others') await listOthers();
        assert.deepEqual((await createBackupManager({ fs, path }).listSnapshots(shared, target)).map((s) => s.name).sort(), earlier,
          'the moved project lists them');
        await listOthers();
        const own = await manager.createSnapshot(target, shared, { automatic: true });
        assert.deepEqual((await manager.listSnapshots(shared, target)).map((s) => s.name).sort(), [...earlier, own.name].sort());
        await listOthers();
        for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
      });
    }

    test('a copy of the moved project never lists the snapshots it recorded as matched', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
      const target = path.join(tmp, 'new-unrelated', 'h', 'i', 'j', 'k', 'l', 'Novel A (final)');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await moveLocked(project, target);
      await unlock(target);
      await manager.createSnapshot(target, shared, { automatic: true });
      const copy = path.join(tmp, 'elsewhere', 'Novel A (final)');
      await fsp.mkdir(path.dirname(copy), { recursive: true });
      await fsp.cp(target, copy, { recursive: true, preserveTimestamps: true });
      assert.ok((await manager.listSnapshots(shared, copy)).every((s) => !earlier.includes(s.name)), 'the copy lists none of them');
      assert.equal((await manager.listSnapshots(shared, target)).filter((s) => s.legacy).length, 2);
    });

    /** Real copies, moves and new folders come well after a snapshot (more than the clock's granularity). */
    const LATER = 150;
    /** Snapshots taken before v1.26.34: no snapshot folder records where they were taken. */
    const forgetOrigins = (shared) => fsp.rm(path.join(shared, '.ensemble-snapshot-origins.json'), { force: true });
    const fresh = () => createBackupManager({ fs, path });
    const names = async (shared, project) => (await fresh().listSnapshots(shared, project)).map((s) => s.name).sort();
    /** Read-only at its new place: list 2; writable and snapshotted: 3 with historical 2; prune 0. */
    async function assertStillListed(shared, target, earlier, { locked = true, label = '' } = {}) {
      if (locked) {
        assert.deepEqual(await names(shared, target), earlier, `${label}: listed while read-only`);
        assert.deepEqual((await fresh().pruneSnapshots(shared, 0, target)).removed, []);
        await unlock(target);
      }
      const own = await fresh().createSnapshot(target, shared, { automatic: true });
      const listed = await fresh().listSnapshots(shared, target);
      assert.equal(listed.length, 3, `${label}: listed 3 once it has its own snapshot`);
      assert.deepEqual(listed.filter((s) => s.legacy).map((s) => s.name).sort(), earlier, `${label}: historical 2`);
      assert.deepEqual((await fresh().pruneSnapshots(shared, 10, target)).removed, [], 'prune removes none');
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
      return own;
    }
    const target = () => path.join(tmp, 'new-unrelated', 'u', 'v', 'w', 'x', 'y', 'z', 'Renamed');

    /*
     * Ownership matrix for older snapshots of a read-only project (id: a path hash that cannot be
     * traced back to its folder), see ORIGINS_FILE in backup-manager.js. "Recorded": a v1.26.34+
     * build listed the folder before the change; "unrecorded": the upgrade path.
     *
     *  folder listing them                         | recorded            | unrecorded
     *  ------------------------------------------- | ------------------- | -------------------
     *  original in place (also touched)            | lists (own)         | lists (own)
     *  moved/renamed on one disk (+touch/edit)     | lists (same inode)  | lists (created before)
     *  moved to another disk (+touch/edit)         | lists (lineage)     | lists (folder times)  M3
     *  ... with a new folder at the old path       | lists; occupant 0   | lists                 M1
     *  cp -r copy made later (+touch/edit)         | 0                   | 0                     M2
     *  cp -a copy made later, opened first         | gives up (*)        | gives up (*)          M2
     *  v1.26.34 claim by a copy                    | given back          | -                     M2
     *  earlier cp -r copy / same-file project      | 0                   | 0                     M4
     *  same, within a second of the last write     | 0                   | gives up (*)          M4
     *  same folder name, other project             | 0                   | restore-only, gives up M4
     *
     * (*) indistinguishable at first contact: listed restore-only (never pruned) until the
     * original is listed, then never again.
     */
    // M1: an unrelated folder created (never opened) where the moved project was.
    for (const [occupant, change] of [['empty folder', null], ['unrelated project', null], ['unrelated project', 'touch'], ['unrelated project', 'edit']]) {
      test(`after a move to another disk, an ${occupant} created at the old path never takes them${change ? `, every file ${change === 'touch' ? 'touched' : 'edited'}` : ''} (reviewer probe M1)`, { skip: posixOnly }, async () => {
        const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
        await new Promise((resolve) => setTimeout(resolve, LATER));
        await fsp.mkdir(path.dirname(target()), { recursive: true });
        await moveAcrossDisks(project, target(), { locked: true });
        if (occupant === 'empty folder') await fsp.mkdir(project);
        else await fsp.writeFile(path.join(await makeProject(project), 'characters', 'other.md'), '# Other');
        if (change) await changeEveryFile(target(), change);
        await assertStillListed(shared, target(), earlier, { label: occupant });
        if (occupant !== 'empty folder') {
          assert.deepEqual(await names(shared, project), [], 'the unrelated project lists none');
          assert.deepEqual((await fresh().pruneSnapshots(shared, 0, project)).removed, []);
        }
        assert.equal((await fresh().listSnapshots(shared, target())).filter((s) => s.legacy).length, 2);
      });
    }

    // M2: a cp -r copy of the moved project, opened before it.
    for (const copyChange of [null, 'touch', 'edit']) {
      test(`after a move to another disk, a cp -r copy of the moved project opened first lists none${copyChange ? ` (copy ${copyChange === 'touch' ? 'touched' : 'edited'})` : ''} (reviewer probe M2)`, { skip: posixOnly }, async () => {
        const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
        await new Promise((resolve) => setTimeout(resolve, LATER));
        await fsp.mkdir(path.dirname(target()), { recursive: true });
        await moveAcrossDisks(project, target(), { locked: true });
        const copy = path.join(tmp, 'far-copies', 'a', 'b', 'c', 'Renamed');
        await fsp.mkdir(path.dirname(copy), { recursive: true });
        await fsp.cp(target(), copy, { recursive: true });
        if (copyChange) await changeEveryFile(copy, copyChange);
        await lock(copy);
        assert.deepEqual(await names(shared, copy), [], 'the copy lists none while read-only');
        await unlock(copy);
        assert.deepEqual(await names(shared, copy), [], 'the copy lists none');
        const copyOwn = await fresh().createSnapshot(copy, shared, { automatic: true });
        assert.deepEqual(await names(shared, copy), [copyOwn.name], 'the copy lists only its own');
        assert.deepEqual((await fresh().pruneSnapshots(shared, 0, copy)).removed, [copyOwn.name]);

        await assertStillListed(shared, target(), earlier, { label: 'moved project' });
        assert.deepEqual(await names(shared, copy), [], 'the copy still lists none');
      });
    }

    test('a copy that v1.26.34 let claim them gives them back to the moved project (reviewer probe M2)', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
      await new Promise((resolve) => setTimeout(resolve, LATER));
      await fsp.mkdir(path.dirname(target()), { recursive: true });
      await moveAcrossDisks(project, target(), { locked: true });
      const copy = path.join(tmp, 'far-copies', 'Renamed');
      await fsp.mkdir(path.dirname(copy), { recursive: true });
      await fsp.cp(target(), copy, { recursive: true });
      await unlock(copy);
      await changeEveryFile(copy, 'touch');
      // What v1.26.34 left after the copy listed first: the copy recorded them as matched, and
      // the snapshot folder names the copy as their folder.
      await fresh().createSnapshot(copy, shared);
      const copyId = (await fsp.readFile(path.join(copy, '.ensemble-backup', 'identity'), 'utf8')).split('\n')[0];
      const oldId = snapshotId(earlier[0]);
      await fsp.writeFile(path.join(copy, '.ensemble-backup', 'identity-claimed'), `${copyId}\n${oldId}\n`);
      const key = await fsp.stat(copy, { bigint: true });
      const originsFile = path.join(shared, '.ensemble-snapshot-origins.json');
      const recorded = JSON.parse(await fsp.readFile(originsFile, 'utf8'));
      recorded[oldId] = { path: await fsp.realpath(copy), dev: String(key.dev), ino: String(key.ino) };
      await fsp.writeFile(originsFile, JSON.stringify(recorded));
      assert.deepEqual((await names(shared, copy)).filter((name) => earlier.includes(name)), earlier, 'v1.26.34 state: the copy lists them');

      await assertStillListed(shared, target(), earlier, { label: 'moved project' });
      assert.ok((await names(shared, copy)).every((name) => !earlier.includes(name)), 'the copy no longer lists them');
      assert.equal((await fresh().listSnapshots(shared, target())).filter((s) => s.legacy).length, 2);
    });

    // M3: snapshots no v1.26.34+ build listed before the move (everyone upgrading).
    for (const locked of [true, false]) {
      for (const change of ['touch', 'edit']) {
        test(`snapshots never listed before a move to another disk stay listed, every file ${change === 'touch' ? 'touched' : 'edited'}, ${locked ? 'still read-only' : 'writable destination'} (reviewer probe M3)`, { skip: posixOnly }, async () => {
          const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
          await forgetOrigins(shared);
          await new Promise((resolve) => setTimeout(resolve, LATER));
          await fsp.mkdir(path.dirname(target()), { recursive: true });
          await moveAcrossDisks(project, target(), { locked });
          await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
          await changeEveryFile(target(), change);
          if (!locked) {
            assert.deepEqual(await names(shared, target()), earlier, 'listed before the first snapshot');
          }
          await assertStillListed(shared, target(), earlier, { locked, label: 'moved project' });
          await changeEveryFile(target(), change);
          assert.equal((await fresh().listSnapshots(shared, target())).filter((s) => s.legacy).length, 2,
            'still historical 2 after touching or editing every file again');
        });
      }
    }

    /**
     * A plain cp -r copy and an unrelated same-name project with the same files, both made
     * before the original's snapshots (and, `apart`, a few seconds after its files were
     * written, as real copies are), with no snapshot folder record (taken before v1.26.34).
     */
    async function earlierOthersUnrecorded({ apart = true } = {}) {
      const others = {};
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A', {
        beforeSnapshots: async (original) => {
          if (apart) await new Promise((resolve) => setTimeout(resolve, 3100));
          const far = path.join(tmp, 'far-away', 'p', 'q', 'r', 's', 't');
          await fsp.mkdir(far, { recursive: true });
          others.copy = path.join(far, 'Novel A cp');
          await fsp.cp(original, others.copy, { recursive: true });
          others.twin = await makeProject(path.join(far, 'other', 'Novel A twin'));
          await fsp.writeFile(path.join(others.twin, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A', settings: {} }));
          await new Promise((resolve) => setTimeout(resolve, LATER));
        },
      });
      await forgetOrigins(shared);
      return { project, shared, earlier, ...others };
    }

    // M4: an earlier copy or unrelated twin opened first (upgrade path).
    test('an earlier copy or unrelated twin opened first lists none of the original\'s unrecorded snapshots, then or after (reviewer probe M4)', { skip: posixOnly }, async () => {
      const { project, shared, earlier, copy, twin } = await earlierOthersUnrecorded();
      for (const other of [copy, twin]) {
        assert.deepEqual(await names(shared, other), [], `${path.basename(other)} lists none`);
        const own = await fresh().createSnapshot(other, shared, { automatic: true });
        assert.deepEqual(await names(shared, other), [own.name], `${path.basename(other)} lists only its own`);
        assert.deepEqual((await fresh().pruneSnapshots(shared, 0, other)).removed, [own.name]);
      }
      assert.deepEqual(await names(shared, project), earlier, 'the original lists them');
      for (const other of [copy, twin]) assert.deepEqual(await names(shared, other), [], `${path.basename(other)} still lists none`);
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    test('an earlier copy or unrelated twin opened first lists none, and the original moved to another disk and touched keeps them (reviewer probe M4 + M3)', { skip: posixOnly }, async () => {
      const { project, shared, earlier, copy, twin } = await earlierOthersUnrecorded();
      await new Promise((resolve) => setTimeout(resolve, LATER));
      await fsp.mkdir(path.dirname(target()), { recursive: true });
      await moveAcrossDisks(project, target(), { locked: true });
      await fsp.rm(path.join(tmp, 'old-unrelated'), { recursive: true });
      await changeEveryFile(target(), 'touch');
      for (const other of [copy, twin]) {
        await lock(other);
        assert.deepEqual(await names(shared, other), [], `${path.basename(other)} lists none while read-only`);
        await unlock(other);
        assert.deepEqual(await names(shared, other), [], `${path.basename(other)} lists none`);
      }
      await assertStillListed(shared, target(), earlier, { label: 'moved original' });
      for (const other of [copy, twin]) assert.deepEqual(await names(shared, other), [], `${path.basename(other)} still lists none`);
    });

    test('an earlier copy made within a second of the original\'s last write stops listing them once the original is listed (reviewer probe M4)', { skip: posixOnly }, async () => {
      // Indistinguishable at first contact (see the report): it must not keep them.
      const { project, shared, earlier, copy } = await earlierOthersUnrecorded({ apart: false });
      await fresh().listSnapshots(shared, copy);
      assert.deepEqual(await names(shared, project), earlier, 'the original lists them');
      assert.deepEqual(await names(shared, copy), [], 'the copy lists none once the original was listed');
      await unlock(project);
      const own = await fresh().createSnapshot(project, shared, { automatic: true });
      assert.deepEqual(await names(shared, project), [...earlier, own.name].sort(), 'the original keeps them once writable');
      assert.deepEqual(await names(shared, copy), [], 'the copy still lists none');
    });

    test('a time-keeping copy (cp -a) of the moved project opened first gives them up once the moved project is listed (reviewer probe M2)', { skip: posixOnly }, async () => {
      // Indistinguishable at first contact (see the report): it must not keep them.
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
      await new Promise((resolve) => setTimeout(resolve, LATER));
      await fsp.mkdir(path.dirname(target()), { recursive: true });
      await moveAcrossDisks(project, target(), { locked: true });
      const copy = path.join(tmp, 'far-copies', 'Renamed');
      await fsp.mkdir(path.dirname(copy), { recursive: true });
      await new Promise((resolve) => setTimeout(resolve, LATER));
      await moveAcrossDisks(target(), copy);
      await fsp.cp(copy, target(), { recursive: true, preserveTimestamps: true });
      // `target` is now the later copy; swap so the earlier-created folder is the moved project.
      const [moved, later] = [copy, target()];
      await lock(moved);
      await fresh().listSnapshots(shared, later);
      await assertStillListed(shared, moved, earlier, { label: 'moved project' });
      assert.ok((await names(shared, later)).every((name) => !earlier.includes(name)), 'the copy no longer lists them');
    });

    test('an unrelated project with the same folder name gives them up once the original is listed, and never prunes them (reviewer probe M4)', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await earlierOthersUnrecorded();
      const twin = await makeProject(path.join(tmp, 'far-away', 'twin', 'Novel A'));
      await fsp.writeFile(path.join(twin, 'ensemble.json'), JSON.stringify({ projectName: 'Novel A', settings: {} }));
      // Not recorded: listed restore-only by folder name (the card's "Older snapshots"), never pruned.
      await fresh().listSnapshots(shared, twin);
      assert.deepEqual((await fresh().pruneSnapshots(shared, 0, twin)).removed, []);
      assert.deepEqual(await names(shared, project), earlier, 'the original lists them');
      assert.deepEqual(await names(shared, twin), [], 'the twin lists none once the original was listed');
      const own = await fresh().createSnapshot(twin, shared, { automatic: true });
      assert.deepEqual(await names(shared, twin), [own.name]);
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    test('in place, older UUID-looking path ids stay listed after touching every file once writable (control)', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
      await unlock(project);
      const own = await manager.createSnapshot(project, shared, { automatic: true });
      const later = new Date(Date.now() + 5000);
      for (const file of await everyFile(project)) await fsp.utimes(file, later, later);
      const listed = await manager.listSnapshots(shared, project);
      assert.deepEqual(listed.map((s) => s.name).sort(), [...earlier, own.name].sort());
      assert.deepEqual((await manager.pruneSnapshots(shared, 10, project)).removed, []);
    });

    test('older UUID-looking path ids are not claimed by a distant copy made later, nor by another project', { skip: posixOnly }, async () => {
      const { project, shared, earlier } = await distantOlderSnapshots('Novel A');
      // Real copies come later than the snapshots.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const far = path.join(tmp, 'new-unrelated', 'h', 'i', 'j', 'k', 'l');
      await fsp.mkdir(far, { recursive: true });
      const copy = path.join(far, 'Novel A cp');
      await unlock(project);
      await fsp.cp(project, copy, { recursive: true });
      await lock(project);
      assert.deepEqual(await manager.listSnapshots(shared, copy), [], 'a cp -r copy lists none');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, []);
      const other = await makeProject(path.join(far, 'Novel B'));
      assert.deepEqual(await manager.listSnapshots(shared, other), [], 'another project lists none');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, other)).removed, []);
      assert.deepEqual((await manager.listSnapshots(shared, project)).map((s) => s.name).sort(), earlier);
      for (const name of earlier) assert.ok(fs.existsSync(path.join(shared, name)));
    });

    test('other projects and copies never claim or prune them', { skip: posixOnly }, async () => {
      const project = await makeProject(path.join(tmp, 'Novel A'));
      const other = await makeProject(path.join(tmp, 'Novel B'));
      const shared = path.join(tmp, 'shared');
      const earlier = await readOnlySnapshots(project, shared);
      await unlock(project);
      await manager.createSnapshot(project, shared);
      const copy = path.join(tmp, 'Novel A cp');
      await fsp.cp(project, copy, { recursive: true });

      assert.deepEqual(await manager.listSnapshots(shared, other), [], 'another project lists none of them');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, other)).removed, []);
      const own = await manager.createSnapshot(copy, shared, { automatic: true });
      assert.deepEqual((await manager.listSnapshots(shared, copy)).map((s) => s.name), [own.name],
        'a copy does not inherit the original\'s older ids');
      assert.deepEqual((await manager.pruneSnapshots(shared, 0, copy)).removed, [own.name]);
      for (const snapshot of earlier) assert.ok(fs.existsSync(snapshot.path), `${snapshot.name} must survive`);
      assert.equal((await manager.listSnapshots(shared, project)).length, 4);
    });
  });

  describe('maybeAutoSnapshotBeforeMigration', () => {
    test('first open records the app version and snapshots nothing', async () => {
      const project = await makeProject(path.join(tmp, 'proj'));
      const result = await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1.21.33' });
      assert.equal(result.reason, 'first-open');
      assert.equal(result.snapshot, undefined);
      const state = JSON.parse(fs.readFileSync(path.join(project, '.ensemble-backup', 'state.json'), 'utf8'));
      assert.equal(state.lastAppVersion, '1.21.33');
    });

    test('reopening the same version does not snapshot', async () => {
      const project = await makeProject(path.join(tmp, 'proj'));
      await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1.21.33' });
      const result = await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1.21.33' });
      assert.equal(result.reason, 'no-migration');
      assert.equal(result.snapshot, undefined);
    });

    test('a version change snapshots before migration and prunes to retention', async () => {
      const project = await makeProject(path.join(tmp, 'proj'));
      await fsp.mkdir(project, { recursive: true });
      await fsp.writeFile(
        path.join(project, 'ensemble.json'),
        JSON.stringify({ settings: { backup: { autoBeforeMigration: true, keepAutomatic: 1 } } }),
        'utf8'
      );
      await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1.21.33' });

      const result = await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1.21.34' });
      assert.equal(result.reason, 'migrated');
      assert.ok(result.snapshot.automatic);
      assert.ok(result.snapshot.dataOnly);
      // Text files only: ensemble.json and the three .md files, not img/portrait.webp.
      assert.equal(result.snapshot.fileCount, 4);
      assert.ok(fs.existsSync(result.snapshot.path));
      // Default backups are project-local and excluded from subsequent snapshots.
      assert.equal(result.backupDir, path.join(project, '.ensemble-backup', 'snapshots'));
      const state = JSON.parse(fs.readFileSync(path.join(project, '.ensemble-backup', 'state.json'), 'utf8'));
      assert.equal(state.lastAppVersion, '1.21.34');
    });

    test('autoBeforeMigration=false disables the automatic snapshot', async () => {
      const project = await makeProject(path.join(tmp, 'proj'));
      await fsp.writeFile(
        path.join(project, 'ensemble.json'),
        JSON.stringify({ settings: { backup: { autoBeforeMigration: false } } }),
        'utf8'
      );
      await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '1.0.0' });
      const result = await manager.maybeAutoSnapshotBeforeMigration(project, { currentAppVersion: '2.0.0' });
      assert.equal(result.reason, 'disabled');
      assert.equal(result.snapshot, undefined);
    });
  });
});
