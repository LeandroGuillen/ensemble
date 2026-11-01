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
const os = require('node:os');
const realFs = require('node:fs/promises');
const { createTrashManager, FLUSH_TIMEOUT_MS, TRASH_DIR_NAME } = require('./trash-manager');

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

describe('dialog-handlers setWorkFolder with a hung shell.trashItem', () => {
  beforeEach(() => {
    setWorkFolder(null);
  });

  it('returns ok after the flush timeouts; staged entries and manifests stay on disk', async () => {
    const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'ensemble-flush-timeout-'));
    try {
      const projectA = path.join(root, 'a');
      const projectB = path.join(root, 'b');
      await realFs.mkdir(path.join(projectA, 'locations'), { recursive: true });
      await realFs.writeFile(path.join(projectA, 'locations', '_harbour.md'), 'harbour');
      // Leftover in B from an earlier crash.
      const leftoverDir = path.join(projectB, TRASH_DIR_NAME, '20240101-120000-location-old-1');
      await realFs.mkdir(leftoverDir, { recursive: true });
      await realFs.writeFile(path.join(leftoverDir, '_old.md'), 'old');
      await realFs.writeFile(
        path.join(leftoverDir, 'manifest.json'),
        JSON.stringify({ kind: 'location', recordId: 'old', name: 'Old', originalPath: path.join(projectB, 'locations', '_old.md') })
      );

      const scheduled = [];
      const timers = {
        setTimeout(fn, ms) {
          const h = { fn, ms, cleared: false };
          scheduled.push(h);
          return h;
        },
        clearTimeout(h) {
          if (h) h.cleared = true;
        },
      };
      const trashCalls = [];
      const rmCalls = [];
      const fsSpy = Object.assign(Object.create(realFs), {
        rm: async (...args) => {
          rmCalls.push(args[0]);
          return realFs.rm(...args);
        },
      });
      const trashManager = createTrashManager({
        fs: fsSpy,
        path,
        shell: {
          trashItem: (p) => {
            trashCalls.push(p);
            return new Promise(() => {});
          },
        },
        timers,
        assertPath: (p) => path.resolve(p),
        warn: () => {},
      });
      const staged = await trashManager.stage(projectA, path.join(projectA, 'locations', '_harbour.md'), {
        kind: 'location',
        recordId: 'harbour',
        name: 'Harbour',
      });

      const ipcMain = createIpcMain();
      register(ipcMain, {
        dialog: {},
        getMainWindow: () => null,
        app: { getVersion: () => '0' },
        fs: { async readFile() { throw new Error('ENOENT'); }, async writeFile() {} },
        path,
        IPC,
        ok,
        err,
        recentProjectsPath: '/tmp/recent.json',
        trashManager,
      });

      let settled = false;
      const pending = ipcMain.invoke(IPC.setWorkFolder, projectB).then((r) => {
        settled = true;
        return r;
      });
      // Fire each flush timeout once its flush is stuck inside trashItem
      // (first flushPending for A, then the leftover commit for B).
      let fired = 0;
      for (let round = 0; round < 500 && !settled; round++) {
        await new Promise((r) => setTimeout(r, 1));
        const armed = scheduled.filter((h) => !h.cleared && h.ms === FLUSH_TIMEOUT_MS);
        if (armed.length && trashCalls.length > fired) {
          fired += 1;
          armed[0].cleared = true;
          armed[0].fn();
        }
      }
      const result = await Promise.race([pending, new Promise((r) => setTimeout(() => r('hung'), 500))]);
      assert.notEqual(result, 'hung', 'setWorkFolder must not wait forever on trashItem');
      assert.equal(result.success, true);
      assert.equal(getWorkFolder(), path.resolve(projectB));
      assert.deepEqual(trashCalls, [staged.stagedPath, path.join(leftoverDir, '_old.md')]);
      await realFs.access(staged.stagedPath);
      await realFs.access(path.join(path.dirname(staged.stagedPath), 'manifest.json'));
      await realFs.access(path.join(leftoverDir, '_old.md'));
      await realFs.access(path.join(leftoverDir, 'manifest.json'));
      assert.deepEqual(rmCalls, []);
    } finally {
      await realFs.rm(root, { recursive: true, force: true });
    }
  });
});

