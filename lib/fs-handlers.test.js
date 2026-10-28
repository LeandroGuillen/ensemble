/**
 * Node-side tests for fs-handlers move/rename overwrite refusal.
 * Run with: node --test lib/fs-handlers.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { register } = require('./fs-handlers');
const { ok, err } = require('./ipc-result');
const IPC = require('../ipc-channels.json');

function createIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    async invoke(channel, ...args) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for ${channel}`);
      return fn({}, ...args);
    },
  };
}

describe('fs-handlers move overwrite refusal', () => {
  let tmpDir;
  let ipcMain;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensemble-fs-'));
    ipcMain = createIpcMain();
    register(ipcMain, {
      fs,
      path,
      IPC,
      ok,
      err,
      assertPath: (p) => p,
      shell: {},
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('moveFile refuses to overwrite an existing destination and keeps the source', async () => {
    const source = path.join(tmpDir, 'source.md');
    const dest = path.join(tmpDir, 'dest.md');
    await fs.writeFile(source, 'source-content');
    await fs.writeFile(dest, 'dest-content');

    const result = await ipcMain.invoke(IPC.moveFile, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /already exists/i);
    assert.equal(await fs.readFile(source, 'utf8'), 'source-content');
    assert.equal(await fs.readFile(dest, 'utf8'), 'dest-content');
  });

  it('moveDirectory refuses to overwrite an existing destination and keeps the source', async () => {
    const source = path.join(tmpDir, 'source.md');
    const dest = path.join(tmpDir, 'dest.md');
    await fs.writeFile(source, 'source-content');
    await fs.writeFile(dest, 'dest-content');

    const result = await ipcMain.invoke(IPC.moveDirectory, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /already exists/i);
    assert.equal(await fs.readFile(source, 'utf8'), 'source-content');
    assert.equal(await fs.readFile(dest, 'utf8'), 'dest-content');
  });

  it('moveDirectory succeeds when destination does not exist', async () => {
    const source = path.join(tmpDir, 'source.md');
    const dest = path.join(tmpDir, 'renamed.md');
    await fs.writeFile(source, 'moved');

    const result = await ipcMain.invoke(IPC.moveDirectory, source, dest);

    assert.equal(result.success, true);
    await assert.rejects(() => fs.access(source));
    assert.equal(await fs.readFile(dest, 'utf8'), 'moved');
  });

  it('moveDirectory treats same source and dest as a successful no-op', async () => {
    const filePath = path.join(tmpDir, 'same.md');
    await fs.writeFile(filePath, 'unchanged');

    const result = await ipcMain.invoke(IPC.moveDirectory, filePath, filePath);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'unchanged');
  });
});
