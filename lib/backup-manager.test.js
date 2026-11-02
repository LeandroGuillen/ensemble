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

  test('createSnapshot fails cleanly on an unreadable file and leaves no zip behind', async (t) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('needs POSIX permissions');
    const project = await makeProject(path.join(tmp, 'proj'));
    const locked = path.join(project, 'characters', 'locked.md');
    await fsp.writeFile(locked, 'secret', 'utf8');
    await fsp.chmod(locked, 0o000);
    const dest = path.join(tmp, 'backups');
    try {
      await assert.rejects(() => manager.createSnapshot(project, dest), /EACCES/);
    } finally {
      await fsp.chmod(locked, 0o644);
    }
    assert.deepEqual(await fsp.readdir(dest), []);
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

    const result = await manager.pruneSnapshots(dest, 1);
    assert.equal(result.kept.length, 1);
    assert.equal(result.removed.length, 2);

    const remaining = await manager.listSnapshots(dest);
    // One automatic (the kept one) plus the manual snapshot survive.
    assert.equal(remaining.filter((s) => s.automatic).length, 1);
    assert.equal(remaining.filter((s) => !s.automatic).length, 1);
    assert.ok(fs.existsSync(manual.path), 'manual snapshot is never pruned');
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
      // Default backup folder is a sibling of the project.
      assert.equal(result.backupDir, path.join(tmp, 'ensemble-backups'));
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
