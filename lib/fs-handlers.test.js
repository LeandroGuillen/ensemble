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

  it('refuses when destination is reached via a symlink to the source', async () => {
    const source = path.join(tmpDir, 'project');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{}');
    const alias = path.join(tmpDir, 'alias-to-project');
    await fs.symlink(source, alias);
    // Text paths look like siblings under tmpDir, but alias → source so dest nests inside.
    const dest = path.join(alias, 'nested-copy');

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, false);
    assert.match(result.error, /into itself|equal to or inside/i);
    await assert.rejects(() => fs.access(path.join(source, 'nested-copy')));
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
      realpath: (...args) => fs.realpath(...args),
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
      realpath: (...args) => fs.realpath(...args),
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

  it('skips .ensemble-trash while copying every other entry including nested and other dotfiles', async () => {
    const source = path.join(tmpDir, 'project');
    const dest = path.join(tmpDir, 'project-copy');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'ensemble.json'), '{"name":"src"}');
    await fs.mkdir(path.join(source, 'characters', 'ada'), { recursive: true });
    await fs.writeFile(path.join(source, 'characters', 'ada', 'ada.md'), '---\nname: Ada\n---\n');
    await fs.mkdir(path.join(source, '.git'));
    await fs.writeFile(path.join(source, '.git', 'config'), 'ok');
    await fs.writeFile(path.join(source, '.hidden-note'), 'keep');
    await fs.mkdir(path.join(source, '.ensemble-trash', 'tok-1'), { recursive: true });
    await fs.writeFile(
      path.join(source, '.ensemble-trash', 'tok-1', 'manifest.json'),
      '{"kind":"character"}'
    );
    await fs.writeFile(path.join(source, '.ensemble-trash', 'tok-1', 'ada.md'), 'staged');

    const result = await ipcMain.invoke(IPC.copyDirectoryRecursive, source, dest);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(path.join(dest, 'ensemble.json'), 'utf8'), '{"name":"src"}');
    assert.equal(
      await fs.readFile(path.join(dest, 'characters', 'ada', 'ada.md'), 'utf8'),
      '---\nname: Ada\n---\n'
    );
    assert.equal(await fs.readFile(path.join(dest, '.git', 'config'), 'utf8'), 'ok');
    assert.equal(await fs.readFile(path.join(dest, '.hidden-note'), 'utf8'), 'keep');
    await assert.rejects(() => fs.access(path.join(dest, '.ensemble-trash')));
    // Source trash untouched.
    assert.equal(
      await fs.readFile(path.join(source, '.ensemble-trash', 'tok-1', 'ada.md'), 'utf8'),
      'staged'
    );
  });
});

describe('fs-handlers hides .ensemble-trash', () => {
  let tmpDir;
  let ipcMain;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensemble-fs-trash-'));
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

    await fs.mkdir(path.join(tmpDir, '.ensemble-trash', 'entry'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.ensemble-trash', 'entry', 'secret.md'), 'nope');
    await fs.writeFile(path.join(tmpDir, 'visible.md'), 'ok');
    await fs.mkdir(path.join(tmpDir, 'characters'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('readDirectoryFiles never returns .ensemble-trash', async () => {
    const result = await ipcMain.invoke(IPC.readDirectoryFiles, tmpDir);
    assert.equal(result.success, true);
    assert.ok(result.directories.includes('characters'));
    assert.ok(result.files.includes('visible.md'));
    assert.equal(result.directories.includes('.ensemble-trash'), false);
    assert.equal(result.files.includes('.ensemble-trash'), false);
  });

  it('readDirectoryRecursive never returns anything under .ensemble-trash', async () => {
    const result = await ipcMain.invoke(IPC.readDirectoryRecursive, tmpDir, '*.md');
    assert.equal(result.success, true);
    const relatives = (result.files || []).map((f) => f.relativePath);
    assert.ok(relatives.some((r) => r === 'visible.md' || r.endsWith(`${path.sep}visible.md`)));
    for (const rel of relatives) {
      assert.equal(rel.includes('.ensemble-trash'), false);
    }
  });
});

describe('fs-handlers trash IPC', () => {
  it('registers trashStage / trashRestore / trashCommit against the trash manager', async () => {
    const calls = [];
    const trashManager = {
      async stage(projectPath, targetPath, meta) {
        calls.push(['stage', projectPath, targetPath, meta]);
        return { success: true, token: 't1', stagedPath: '/s', expiresAt: 1 };
      },
      async restore(token) {
        calls.push(['restore', token]);
        return { success: true };
      },
      async commit(token) {
        calls.push(['commit', token]);
        return { success: true };
      },
    };

    const ipcMain = createIpcMain();
    register(ipcMain, {
      fs,
      path,
      IPC,
      ok,
      err,
      assertPath: (p) => p,
      shell: {},
      trashManager,
    });

    const stage = await ipcMain.invoke(IPC.trashStage, '/p', '/p/a.md', {
      kind: 'location',
      recordId: '1',
      name: 'A',
    });
    assert.equal(stage.success, true);
    assert.equal(stage.token, 't1');

    const restore = await ipcMain.invoke(IPC.trashRestore, 't1');
    assert.equal(restore.success, true);

    const commit = await ipcMain.invoke(IPC.trashCommit, 't1');
    assert.equal(commit.success, true);

    assert.deepEqual(calls, [
      ['stage', '/p', '/p/a.md', { kind: 'location', recordId: '1', name: 'A' }],
      ['restore', 't1'],
      ['commit', 't1'],
    ]);
  });
});

