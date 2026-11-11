const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { register } = require('./backup-handlers');

const message = "This project folder is read-only, so snapshots can't be saved inside it. Choose a backup folder in Settings → Backup.";
const project = path.resolve('/projects/Readonly');
const dest = path.join(project, '.ensemble-backup', 'snapshots');

function handler(error, backupManager = { createSnapshot: async () => { throw error; } }) {
  const handlers = {};
  register({ handle: (channel, fn) => { handlers[channel] = fn; } }, {
    path, IPC: { backupCreate: 'create' },
    assertPath: value => value,
    ok: value => ({ success: true, ...value }),
    err: error => ({ success: false, error }),
    backupManager,
  });
  return handlers.create;
}

for (const code of ['EACCES', 'EPERM', 'EROFS']) {
  for (const target of [path.dirname(dest), dest, path.join(dest, 'snapshot.zip.partial')]) {
    test(`${code} at default destination ${target} returns actionable text without errno`, async () => {
      const error = Object.assign(new Error(`${code}: permission denied '${target}'`), { code, path: target });
      const result = await handler(error)(null, project, dest);
      assert.equal(result.error, message);
      assert.equal(result.errorCode, 'BACKUP_DESTINATION_READ_ONLY');
    });
  }
}

test('omitted destination uses the same read-only mapping', async () => {
  const error = Object.assign(new Error('EROFS'), { code: 'EROFS', path: dest });
  assert.equal((await handler(error)(null, project)).error, message);
});

for (const [code, target, destination] of [
  ['EACCES', path.join(project, 'characters', 'mara.md'), dest],
  ['EACCES', `${dest}-other`, dest],
  ['EACCES', '/custom/backups', '/custom/backups'],
  ['ENOSPC', dest, dest],
]) {
  test(`preserves unrelated ${code} error at ${target}`, async () => {
    const error = Object.assign(new Error(`${code}: original detail`), { code, path: target });
    const result = await handler(error)(null, project, destination);
    assert.equal(result.error, error.message);
    assert.equal(result.errorCode, undefined);
  });
}

test('a read-only default failure can be retried into a writable folder through IPC', async (t) => {
  const fs = require('node:fs/promises');
  const { createBackupManager } = require('./backup-manager');
  const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'ensemble-readonly-backup-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, 'Readonly');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'ensemble.json'), '{"settings":{}}');
  await fs.writeFile(path.join(source, 'story.md'), '# A story');
  const localState = path.join(source, '.ensemble-backup');
  // Deterministic even when the test runner has privileges that bypass chmod.
  const readonlyFs = { ...fs, mkdir: async (dir, opts) => {
    if (dir === localState || dir.startsWith(localState + path.sep)) {
      throw Object.assign(new Error(`EACCES: permission denied, mkdir '${dir}'`), { code: 'EACCES', path: dir });
    }
    return fs.mkdir(dir, opts);
  } };
  const create = handler(null, createBackupManager({ fs: readonlyFs, path }));
  const failed = await create(null, source);
  assert.equal(failed.error, message);
  assert.equal(failed.errorCode, 'BACKUP_DESTINATION_READ_ONLY');
  const writable = path.join(tmp, 'backups');
  const result = await create(null, source, writable);
  assert.equal(result.success, true);
  assert.equal(path.dirname(result.snapshot.path), writable);
  assert.equal(result.snapshot.fileCount, 2);
  assert.ok((await fs.stat(result.snapshot.path)).size > 0);
  assert.equal(await fs.readFile(path.join(source, 'ensemble.json'), 'utf8'), '{"settings":{}}');
  await assert.rejects(fs.stat(localState), { code: 'ENOENT' });
});
