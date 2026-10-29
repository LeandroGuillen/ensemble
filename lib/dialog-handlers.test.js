/**
 * Node-side tests for setWorkFolder trash flush / crash recovery.
 * Run with: node --test lib/dialog-handlers.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { register } = require('./dialog-handlers');
const { setWorkFolder, getWorkFolder } = require('./path-guard');
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

describe('dialog-handlers setWorkFolder trash flush', () => {
  beforeEach(() => {
    setWorkFolder(null);
  });

  it('flushes previous pending entries then commits leftovers on the new project', async () => {
    const calls = [];
    const trashManager = {
      async flushPending() {
        calls.push('flushPending');
      },
      async commitLeftoversOnDisk(projectPath) {
        calls.push(`leftovers:${projectPath}`);
        return { success: true };
      },
    };

    const ipcMain = createIpcMain();
    register(ipcMain, {
      dialog: {},
      getMainWindow: () => null,
      app: { getVersion: () => '0' },
      fs: {
        async readFile() {
          throw new Error('ENOENT');
        },
        async writeFile() {},
      },
      path,
      IPC,
      ok,
      err,
      recentProjectsPath: '/tmp/recent.json',
      trashManager,
    });

    const nextProject = '/work/next-project';
    const result = await ipcMain.invoke(IPC.setWorkFolder, nextProject);

    assert.equal(result.success, true);
    assert.deepEqual(calls, ['flushPending', `leftovers:${nextProject}`]);
    assert.equal(getWorkFolder(), path.resolve(nextProject));
  });

  it('still flushes previous pending when clearing the work folder', async () => {
    const calls = [];
    const trashManager = {
      async flushPending() {
        calls.push('flushPending');
      },
      async commitLeftoversOnDisk() {
        calls.push('leftovers');
        return { success: true };
      },
    };

    setWorkFolder('/work/prev');
    const ipcMain = createIpcMain();
    register(ipcMain, {
      dialog: {},
      getMainWindow: () => null,
      app: { getVersion: () => '0' },
      fs: {
        async readFile() {
          throw new Error('ENOENT');
        },
        async writeFile() {},
      },
      path,
      IPC,
      ok,
      err,
      recentProjectsPath: '/tmp/recent.json',
      trashManager,
    });

    const result = await ipcMain.invoke(IPC.setWorkFolder, null);
    assert.equal(result.success, true);
    assert.deepEqual(calls, ['flushPending']);
    assert.equal(getWorkFolder(), null);
  });
});
