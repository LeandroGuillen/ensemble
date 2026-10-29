/**
 * Node-side tests for file-watcher ignore rules.
 * Run with: node --test lib/file-watcher.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { register, closeWatcher, setFileWatcher } = require('./file-watcher');
const { ok, err } = require('./ipc-result');
const IPC = require('../ipc-channels.json');

/** Same ignore pattern chokidar is configured with in file-watcher.js. */
const DOT_PATH_IGNORE = /(^|[\/\\])\../;

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
  it('dot-path ignore regex matches .ensemble-trash paths', () => {
    assert.equal(DOT_PATH_IGNORE.test('.ensemble-trash'), true);
    assert.equal(DOT_PATH_IGNORE.test('.ensemble-trash/entry/file.md'), true);
    assert.equal(DOT_PATH_IGNORE.test('project/.ensemble-trash/x'), true);
    assert.equal(DOT_PATH_IGNORE.test('characters/hero.md'), false);
  });

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
    assert.equal(watchOptions.ignored.test('.ensemble-trash/tok/hero.md'), true);
    assert.equal(watchOptions.ignored.test('characters/hero.md'), false);

    // Simulate a change under .ensemble-trash — ignored pattern means chokidar
    // would not invoke handlers; assert our wired handlers exist but the ignore
    // would have filtered the path before delivery.
    const changeHandler = captured.find((c) => c.event === 'change');
    assert.ok(changeHandler);

    await closeWatcher();
    setFileWatcher(null);
  });
});
