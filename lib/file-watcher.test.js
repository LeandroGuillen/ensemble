/**
 * Node-side tests for file-watcher ignore rules.
 * Run with: node --test lib/file-watcher.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { register, closeWatcher } = require('./file-watcher');
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

describe('file-watcher .ensemble-trash ignore', () => {
  it('startFileWatcher configures chokidar with the dot-path ignore (no events for .ensemble-trash)', async () => {
    const captured = [];
    const fakeWatcher = {
      on(event, fn) {
        captured.push({ event, fn });
        return fakeWatcher;
      },
      async close() {},
    };

    let watchOptions = null;
    const chokidar = {
      watch(paths, options) {
        watchOptions = options;
        return fakeWatcher;
      },
    };

    const ipcMain = createIpcMain();
    register(ipcMain, {
      chokidar,
      path,
      IPC,
      ok,
      err,
      getMainWindow: () => null,
      normalizeRelativeFolder: (folder, fallback) => folder || fallback,
      assertPath: (p) => p,
    });

    const result = await ipcMain.invoke(IPC.startFileWatcher, '/work/project', ['characters']);
    assert.equal(result.success, true);
    assert.ok(watchOptions);
    assert.ok(watchOptions.ignored);
    for (const ignored of ['.ensemble-trash', '.ensemble-trash/tok/hero.md', '/work/project/.ensemble-trash/x']) {
      assert.equal(watchOptions.ignored.test(ignored), true, ignored);
    }
    assert.equal(watchOptions.ignored.test('characters/hero.md'), false);
    assert.deepEqual(captured.map((c) => c.event), ['add', 'change', 'unlink']);

    await closeWatcher();
  });
});
