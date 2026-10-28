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

describe('fs-handlers copyDirectoryRecursive safeguards', () => {
  let tmpDir;
  let ipcMain;

  function registerWithFs(fsImpl) {
    ipcMain = createIpcMain();
    register(ipcMain, {
      fs: fsImpl,
      path,
      IPC,
      ok,
      err,
      assertPath: (p) => p,
      shell: {},
    });
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensemble-fs-copy-'));
    registerWithFs(fs);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('refuses when destination equals source', async () => {
    const source = path.join(tmpDir, 'project');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{}');

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, source);

    assert.equal(result.success, false);
    assert.match(result.error, /into itself|equal to or inside/i);
  });

  it('refuses when destination is inside source', async () => {
    const source = path.join(tmpDir, 'project');
    const dest = path.join(source, 'nested-copy');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{}');

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /into itself|equal to or inside/i);
    await assert.rejects(() => fs.access(dest));
  });

  it('allows sibling destinations that share a name prefix', async () => {
    const source = path.join(tmpDir, 'mybook');
    const dest = path.join(tmpDir, 'mybook-copy');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{"name":"mybook"}');

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(path.join(dest, 'ensemble.json'), 'utf8'), '{"name":"mybook"}');
  });

  it('rejects a non-empty existing destination without merging', async () => {
    const source = path.join(tmpDir, 'project');
    const dest = path.join(tmpDir, 'existing');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{"from":"source"}');
    await fs.mkdir(dest);
    await fs.writeFile(path.join(dest, 'keep-me.txt'), 'pre-existing');

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /not empty/i);
    assert.equal(await fs.readFile(path.join(dest, 'keep-me.txt'), 'utf8'), 'pre-existing');
    await assert.rejects(() => fs.access(path.join(dest, 'ensemble.json')));
  });

  it('allows an empty existing destination', async () => {
    const source = path.join(tmpDir, 'project');
    const dest = path.join(tmpDir, 'empty-dest');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{"ok":true}');
    await fs.mkdir(dest);

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(path.join(dest, 'ensemble.json'), 'utf8'), '{"ok":true}');
  });

  it('on partial failure cleans up only paths created by this call', async () => {
    const source = path.join(tmpDir, 'project');
    const dest = path.join(tmpDir, 'empty-dest');
    await fs.mkdir(source);
    // Lexicographic order copies a-ok before z-fail so something exists to clean up.
    await fs.writeFile(path.join(source, 'a-ok.txt'), 'ok');
    await fs.writeFile(path.join(source, 'z-fail.txt'), 'fail');
    await fs.mkdir(dest);

    const failFs = {
      mkdir: (...args) => fs.mkdir(...args),
      readdir: (...args) => fs.readdir(...args),
      access: (...args) => fs.access(...args),
      stat: (...args) => fs.stat(...args),
      rm: (...args) => fs.rm(...args),
      copyFile: async (src, d) => {
        if (String(d).endsWith(`${path.sep}z-fail.txt`) || String(d).endsWith('/z-fail.txt')) {
          throw new Error('simulated copy failure');
        }
        return fs.copyFile(src, d);
      },
    };
    registerWithFs(failFs);

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /simulated copy failure/);
    // Pre-existing empty destination directory remains.
    const destStat = await fs.stat(dest);
    assert.equal(destStat.isDirectory(), true);
    // Nothing created by this call should remain inside it (a-ok.txt must be cleaned up).
    const remaining = await fs.readdir(dest);
    assert.deepEqual(remaining, []);
  });

  it('on partial failure removes a destination that did not exist before', async () => {
    const source = path.join(tmpDir, 'project');
    const dest = path.join(tmpDir, 'new-dest');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'a-ok.txt'), 'ok');
    await fs.writeFile(path.join(source, 'z-fail.txt'), 'fail');

    const failFs = {
      mkdir: (...args) => fs.mkdir(...args),
      readdir: (...args) => fs.readdir(...args),
      access: (...args) => fs.access(...args),
      stat: (...args) => fs.stat(...args),
      rm: (...args) => fs.rm(...args),
      copyFile: async (src, d) => {
        if (String(d).endsWith(`${path.sep}z-fail.txt`) || String(d).endsWith('/z-fail.txt')) {
          throw new Error('simulated copy failure');
        }
        return fs.copyFile(src, d);
      },
    };
    registerWithFs(failFs);

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /simulated copy failure/);
    await assert.rejects(() => fs.access(dest));
  });
});
