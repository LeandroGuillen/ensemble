const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
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

describe('backup-manager', () => {
  let tmp;
  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ensemble-backup-'));
  });
  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
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
    assert.equal((await fsp.readdir(dest)).length, 1);
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

  test('shared folder listing excludes other projects and legacy snapshots', async () => {
    const a = await makeProject(path.join(tmp, 'Novel A'));
    const b = await makeProject(path.join(tmp, 'Novel B'));
    const dest = path.join(tmp, 'backups');
    await manager.createSnapshot(a, dest);
    const own = await manager.createSnapshot(b, dest);
    await fsp.writeFile(path.join(dest, 'ensemble-backup-legacy.zip'), 'unknown');
    assert.deepEqual((await manager.listSnapshots(dest, b)).map(s => s.name), [own.name],
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
