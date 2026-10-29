/**
 * Node-side tests for trash-manager (faked fs, shell, timers).
 * Run with: node --test lib/trash-manager.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  UNDO_WINDOW_MS,
  TRASH_DIR_NAME,
  createTrashManager,
  createQuitFlushGuard,
} = require('./trash-manager');

function createMemoryFs(initial = {}) {
  /** @type {Map<string, { type: 'file'|'dir', content?: string }>} */
  const store = new Map();

  function norm(p) {
    return path.resolve(p);
  }

  function ensureParent(filePath) {
    const parent = path.dirname(filePath);
    if (parent === filePath) return;
    const parts = [];
    let cur = parent;
    while (!store.has(cur) && cur !== path.dirname(cur)) {
      parts.unshift(cur);
      cur = path.dirname(cur);
    }
    for (const dir of parts) {
      store.set(dir, { type: 'dir' });
    }
    if (!store.has(parent) && parent !== path.dirname(parent)) {
      store.set(parent, { type: 'dir' });
    }
  }

  for (const [p, value] of Object.entries(initial)) {
    const resolved = norm(p);
    if (value === null || (typeof value === 'object' && value.dir)) {
      ensureParent(resolved);
      store.set(resolved, { type: 'dir' });
    } else {
      ensureParent(resolved);
      store.set(resolved, { type: 'file', content: String(value) });
    }
  }

  // Always have a root project dir placeholder via ensureParent on first write.

  const api = {
    _store: store,
    async mkdir(dirPath, options = {}) {
      const resolved = norm(dirPath);
      if (store.has(resolved)) {
        const existing = store.get(resolved);
        if (existing.type !== 'dir') {
          throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' });
        }
        // Match Node: recursive succeeds on existing dir; exclusive fails with EEXIST.
        if (options.recursive) {
          return;
        }
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      if (options.recursive) {
        ensureParent(resolved);
        store.set(resolved, { type: 'dir' });
        return;
      }
      const parent = path.dirname(resolved);
      if (!store.has(parent)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      store.set(resolved, { type: 'dir' });
    },
    async rename(from, to) {
      const src = norm(from);
      const dest = norm(to);
      if (!store.has(src)) {
        throw Object.assign(new Error(`ENOENT: ${src}`), { code: 'ENOENT' });
      }
      if (store.has(dest)) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      ensureParent(dest);
      const entry = store.get(src);
      store.delete(src);
      store.set(dest, entry);
      // Move children if directory
      if (entry.type === 'dir') {
        const prefix = src + path.sep;
        const moves = [];
        for (const [key, value] of store.entries()) {
          if (key.startsWith(prefix)) {
            moves.push([key, dest + key.slice(src.length), value]);
          }
        }
        for (const [oldKey, newKey, value] of moves) {
          store.delete(oldKey);
          store.set(newKey, value);
        }
      }
    },
    async writeFile(filePath, content) {
      const resolved = norm(filePath);
      ensureParent(resolved);
      store.set(resolved, { type: 'file', content: String(content) });
    },
    async readFile(filePath, encoding) {
      const resolved = norm(filePath);
      const entry = store.get(resolved);
      if (!entry || entry.type !== 'file') {
        throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
      }
      return encoding ? entry.content : Buffer.from(entry.content || '');
    },
    async access(filePath) {
      const resolved = norm(filePath);
      if (!store.has(resolved)) {
        throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
      }
    },
    async unlink(filePath) {
      const resolved = norm(filePath);
      const entry = store.get(resolved);
      if (!entry) {
        throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
      }
      if (entry.type !== 'file') {
        throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
      }
      store.delete(resolved);
    },
    async rmdir(dirPath) {
      const resolved = norm(dirPath);
      const entry = store.get(resolved);
      if (!entry || entry.type !== 'dir') {
        throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
      }
      const prefix = resolved + path.sep;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          throw Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' });
        }
      }
      store.delete(resolved);
    },
    async rm(targetPath, options = {}) {
      const resolved = norm(targetPath);
      if (!store.has(resolved)) {
        if (options.force) return;
        throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
      }
      const prefix = resolved + path.sep;
      if (options.recursive) {
        for (const key of [...store.keys()]) {
          if (key === resolved || key.startsWith(prefix)) {
            store.delete(key);
          }
        }
        return;
      }
      await api.unlink(resolved);
    },
    async readdir(dirPath, options = {}) {
      const resolved = norm(dirPath);
      const entry = store.get(resolved);
      if (!entry || entry.type !== 'dir') {
        throw Object.assign(new Error(`ENOENT: ${resolved}`), { code: 'ENOENT' });
      }
      const prefix = resolved + path.sep;
      const names = new Set();
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split(path.sep)[0];
        if (name) names.add(name);
      }
      if (options.withFileTypes) {
        return [...names].map((name) => {
          const child = store.get(path.join(resolved, name));
          return {
            name,
            isDirectory: () => child && child.type === 'dir',
            isFile: () => child && child.type === 'file',
          };
        });
      }
      return [...names];
    },
    exists(p) {
      return store.has(norm(p));
    },
    read(p) {
      const entry = store.get(norm(p));
      return entry && entry.type === 'file' ? entry.content : undefined;
    },
  };

  return api;
}

function createFakeTimers() {
  /** @type {{ id: object, fn: Function, ms: number, cleared: boolean }[]} */
  const scheduled = [];
  let nextId = 1;
  return {
    scheduled,
    setTimeout(fn, ms) {
      const handle = { id: nextId++, fn, ms, cleared: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (handle) handle.cleared = true;
    },
    async tick(ms) {
      const due = scheduled.filter((h) => !h.cleared && h.ms <= ms);
      for (const h of due) {
        h.cleared = true;
        await h.fn();
      }
    },
  };
}

describe('trash-manager', () => {
  const projectPath = '/work/project';
  let fs;
  let shell;
  let timers;
  let failures;
  let trashCalls;
  let rmCalls;
  let unlinkCalls;
  let manager;
  let clock;

  function install() {
    clock = 1_700_000_000_000;
    fs = createMemoryFs({
      [projectPath]: { dir: true },
      [path.join(projectPath, 'characters')]: { dir: true },
      [path.join(projectPath, 'characters', 'hero')]: { dir: true },
      [path.join(projectPath, 'characters', 'hero', 'hero.md')]: 'hero body',
      [path.join(projectPath, 'locations')]: { dir: true },
      [path.join(projectPath, 'locations', '_harbour.md')]: 'harbour body',
    });

    trashCalls = [];
    rmCalls = [];
    unlinkCalls = [];
    failures = [];

    const rawRm = fs.rm.bind(fs);
    const rawUnlink = fs.unlink.bind(fs);
    fs.rm = async (p, opts) => {
      rmCalls.push({ path: p, opts });
      return rawRm(p, opts);
    };
    fs.unlink = async (p) => {
      unlinkCalls.push(p);
      return rawUnlink(p);
    };

    shell = {
      trashItem: async (itemPath) => {
        trashCalls.push(itemPath);
        // Simulate OS trash: remove the staged item only.
        await rawRm(itemPath, { recursive: true, force: true });
      },
    };

    timers = createFakeTimers();

    manager = createTrashManager({
      fs,
      path,
      shell,
      timers,
      assertPath: (p) => {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(path.resolve(projectPath))) {
          throw new Error('Path is outside the work folder and allowed directories');
        }
        return resolved;
      },
      emitCommitFailed: (payload) => failures.push(payload),
      now: () => clock,
    });
  }

  beforeEach(() => {
    install();
  });

  it('exports UNDO_WINDOW_MS as 15000 from the shared constant', () => {
    assert.equal(UNDO_WINDOW_MS, 15000);
    assert.equal(manager.UNDO_WINDOW_MS, 15000);
  });

  it('stages a folder into .ensemble-trash with a correct manifest', async () => {
    const target = path.join(projectPath, 'characters', 'hero');
    const result = await manager.stage(projectPath, target, {
      kind: 'character',
      recordId: 'char1',
      name: 'Hero',
    });

    assert.equal(result.success, true);
    assert.ok(result.token);
    assert.match(result.token, /^\d{8}-\d{6}-character-char1-\d+$/);
    assert.equal(result.expiresAt, clock + UNDO_WINDOW_MS);

    const expectedStaged = path.join(
      projectPath,
      TRASH_DIR_NAME,
      result.token,
      'hero'
    );
    assert.equal(result.stagedPath, expectedStaged);
    assert.equal(fs.exists(target), false);
    assert.equal(fs.exists(expectedStaged), true);
    assert.equal(
      fs.exists(path.join(expectedStaged, 'hero.md')),
      true
    );

    const manifest = JSON.parse(
      fs.read(path.join(projectPath, TRASH_DIR_NAME, result.token, 'manifest.json'))
    );
    assert.equal(manifest.kind, 'character');
    assert.equal(manifest.recordId, 'char1');
    assert.equal(manifest.name, 'Hero');
    assert.equal(manifest.originalPath, path.resolve(target));
    assert.equal(manifest.stagedAt, clock);
  });

  it('stages a single .md file into .ensemble-trash with a correct manifest', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const result = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    assert.equal(result.success, true);
    const expectedStaged = path.join(
      projectPath,
      TRASH_DIR_NAME,
      result.token,
      '_harbour.md'
    );
    assert.equal(result.stagedPath, expectedStaged);
    assert.equal(fs.exists(target), false);
    assert.equal(fs.read(expectedStaged), 'harbour body');

    const manifest = JSON.parse(
      fs.read(path.join(projectPath, TRASH_DIR_NAME, result.token, 'manifest.json'))
    );
    assert.equal(manifest.kind, 'location');
    assert.equal(manifest.originalPath, path.resolve(target));
  });

  it('refuses a path outside the work folder and moves nothing', async () => {
    const outside = '/tmp/evil.md';
    const fs2 = createMemoryFs({
      [projectPath]: { dir: true },
      [path.join(projectPath, 'safe.md')]: 'safe',
      [outside]: 'evil',
    });
    const mgr = createTrashManager({
      fs: fs2,
      path,
      shell: { trashItem: async () => {} },
      timers: createFakeTimers(),
      assertPath: (p) => {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(path.resolve(projectPath))) {
          throw new Error('Path is outside the work folder and allowed directories');
        }
        return resolved;
      },
      now: () => clock,
    });

    const result = await mgr.stage(projectPath, outside, {
      kind: 'file',
      recordId: 'x',
      name: 'Evil',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /outside/i);
    assert.equal(fs2.read(outside), 'evil');
    assert.equal(fs2.exists(path.join(projectPath, TRASH_DIR_NAME)), false);
  });

  it('leaves the original untouched when rename fails', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const originalRename = fs.rename.bind(fs);
    fs.rename = async () => {
      throw new Error('rename exploded');
    };

    const result = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /rename exploded/);
    fs.rename = originalRename;
    assert.equal(fs.read(target), 'harbour body');
  });

  it('when manifest write fails and rename-back succeeds, restores original and removes empty entry dir', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const originalWrite = fs.writeFile.bind(fs);
    fs.writeFile = async (filePath, content) => {
      if (String(filePath).endsWith('manifest.json')) {
        throw new Error('manifest write failed');
      }
      return originalWrite(filePath, content);
    };

    const result = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /manifest write failed/);
    assert.equal(fs.read(target), 'harbour body');
    assert.equal(manager.listPendingTokens().length, 0);
    // Empty wrapper gone; no leftover under .ensemble-trash for this attempt.
    const trashRoot = path.join(projectPath, TRASH_DIR_NAME);
    if (fs.exists(trashRoot)) {
      const leftovers = await fs.readdir(trashRoot);
      assert.equal(leftovers.length, 0);
    }
  });

  it('when manifest write fails and rename-back also fails, never rm/rmdir the staged item or entry', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const originalWrite = fs.writeFile.bind(fs);
    const originalRename = fs.rename.bind(fs);
    let renameCount = 0;

    fs.writeFile = async (filePath, content) => {
      if (String(filePath).endsWith('manifest.json')) {
        throw new Error('manifest write failed');
      }
      return originalWrite(filePath, content);
    };

    fs.rename = async (from, to) => {
      renameCount += 1;
      if (renameCount === 1) {
        // First rename: stage the file successfully.
        return originalRename(from, to);
      }
      throw new Error('rename-back exploded');
    };

    const rmCallsLocal = [];
    const rmdirCallsLocal = [];
    const rawRm = fs.rm.bind(fs);
    const rawRmdir = fs.rmdir.bind(fs);
    fs.rm = async (p, opts) => {
      rmCallsLocal.push(path.resolve(p));
      return rawRm(p, opts);
    };
    fs.rmdir = async (p) => {
      rmdirCallsLocal.push(path.resolve(p));
      return rawRmdir(p);
    };

    const result = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    assert.equal(result.success, false);
    assert.match(result.error, /manifest write failed/);
    assert.match(result.error, /remains staged at/);
    assert.equal(manager.listPendingTokens().length, 0);

    // Staged item still present under .ensemble-trash.
    const trashRoot = path.join(projectPath, TRASH_DIR_NAME);
    const entries = await fs.readdir(trashRoot);
    assert.equal(entries.length, 1);
    const entryDir = path.join(trashRoot, entries[0]);
    const stagedPath = path.join(entryDir, '_harbour.md');
    assert.equal(fs.read(stagedPath), 'harbour body');
    assert.match(result.error, new RegExp(stagedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    // No fs.rm / fs.rmdir may touch the entry dir or the staged item.
    for (const p of [...rmCallsLocal, ...rmdirCallsLocal]) {
      assert.notEqual(p, path.resolve(entryDir));
      assert.notEqual(p, path.resolve(stagedPath));
      assert.equal(p.startsWith(path.resolve(entryDir) + path.sep), false);
    }
  });

  it('calls shell.trashItem after UNDO_WINDOW_MS and removes the wrapper', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const result = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });
    assert.equal(result.success, true);

    const entryDir = path.join(projectPath, TRASH_DIR_NAME, result.token);
    assert.equal(fs.exists(entryDir), true);

    await timers.tick(UNDO_WINDOW_MS);

    assert.deepEqual(trashCalls, [result.stagedPath]);
    assert.equal(fs.exists(entryDir), false);
    assert.equal(fs.exists(path.join(entryDir, 'manifest.json')), false);
    assert.equal(manager.listPendingTokens().length, 0);
  });

  it('keeps the entry and emits trash-commit-failed when trashItem rejects', async () => {
    shell.trashItem = async () => {
      trashCalls.push('attempt');
      throw new Error('os trash unavailable');
    };

    const target = path.join(projectPath, 'locations', '_harbour.md');
    const result = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    // Reset tracking of staging cleanup unlinks
    rmCalls.length = 0;
    unlinkCalls.length = 0;

    await timers.tick(UNDO_WINDOW_MS);

    assert.deepEqual(trashCalls, ['attempt']);
    assert.equal(fs.exists(result.stagedPath), true);
    assert.equal(
      fs.exists(path.join(projectPath, TRASH_DIR_NAME, result.token, 'manifest.json')),
      true
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].token, result.token);
    assert.equal(failures[0].name, 'Harbour');
    assert.equal(failures[0].stagedPath, result.stagedPath);
    assert.match(failures[0].error, /os trash unavailable/);

    // No fs.rm/unlink may touch the staged item itself.
    for (const call of rmCalls) {
      assert.notEqual(path.resolve(call.path), path.resolve(result.stagedPath));
    }
    for (const p of unlinkCalls) {
      assert.notEqual(path.resolve(p), path.resolve(result.stagedPath));
    }
  });

  it('restores within the window and cancels the timer', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    const restoreResult = await manager.restore(staged.token);
    assert.equal(restoreResult.success, true);
    assert.equal(fs.read(target), 'harbour body');
    assert.equal(fs.exists(staged.stagedPath), false);

    await timers.tick(UNDO_WINDOW_MS);
    assert.equal(trashCalls.length, 0);
  });

  it('refuses restore for unknown token without changing disk', async () => {
    const before = [...fs._store.keys()];
    const result = await manager.restore('no-such-token');
    assert.equal(result.success, false);
    assert.match(result.error, /unknown/i);
    assert.deepEqual([...fs._store.keys()], before);
  });

  it('refuses restore when originalPath already exists', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    // Recreate something at the original path.
    await fs.writeFile(target, 'recreated');

    const beforeStaged = fs.read(staged.stagedPath);
    const result = await manager.restore(staged.token);
    assert.equal(result.success, false);
    assert.match(result.error, /already exists/i);
    assert.equal(fs.read(staged.stagedPath), beforeStaged);
    assert.equal(fs.read(target), 'recreated');
  });

  it('refuses restore for an already-committed entry', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    const commitResult = await manager.commit(staged.token);
    assert.equal(commitResult.success, true);

    const beforeKeys = [...fs._store.keys()];
    const restoreResult = await manager.restore(staged.token);
    assert.equal(restoreResult.success, false);
    assert.match(restoreResult.error, /already committed/i);
    assert.deepEqual([...fs._store.keys()], beforeKeys);

    const again = await manager.commit(staged.token);
    assert.equal(again.success, false);
    assert.match(again.error, /already committed/i);
  });

  it('trashCommit commits immediately without waiting for the window', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });

    const result = await manager.commit(staged.token);
    assert.equal(result.success, true);
    assert.deepEqual(trashCalls, [staged.stagedPath]);
    assert.equal(fs.exists(path.join(projectPath, TRASH_DIR_NAME, staged.token)), false);

    await timers.tick(UNDO_WINDOW_MS);
    assert.equal(trashCalls.length, 1);
  });

  it('flushPending commits all pending entries; failed ones stay staged', async () => {
    const fileA = path.join(projectPath, 'locations', '_harbour.md');
    const fileB = path.join(projectPath, 'characters', 'hero', 'hero.md');

    const a = await manager.stage(projectPath, fileA, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });
    const b = await manager.stage(projectPath, fileB, {
      kind: 'character',
      recordId: 'char1',
      name: 'HeroMd',
    });

    let failNext = true;
    shell.trashItem = async (itemPath) => {
      trashCalls.push(itemPath);
      if (failNext) {
        failNext = false;
        throw new Error('first failed');
      }
      await fs.rm(itemPath, { recursive: true, force: true });
    };

    await manager.flushPending();

    assert.equal(trashCalls.length, 2);
    // One failed — still staged; one succeeded — gone.
    const aStill = fs.exists(a.stagedPath);
    const bStill = fs.exists(b.stagedPath);
    assert.equal(aStill || bStill, true);
    assert.equal(aStill && bStill, false);
    assert.equal(failures.length, 1);
  });

  it('commitLeftoversOnDisk commits crash-recovery entries found on disk', async () => {
    const token = '20240101-120000-location-orphan';
    const entryDir = path.join(projectPath, TRASH_DIR_NAME, token);
    const stagedPath = path.join(entryDir, '_orphan.md');
    const originalPath = path.join(projectPath, 'locations', '_orphan.md');

    await fs.mkdir(entryDir, { recursive: true });
    await fs.writeFile(stagedPath, 'orphan body');
    await fs.writeFile(
      path.join(entryDir, 'manifest.json'),
      JSON.stringify({
        kind: 'location',
        recordId: 'orphan',
        name: 'Orphan',
        originalPath,
        stagedAt: clock,
      })
    );

    const result = await manager.commitLeftoversOnDisk(projectPath);
    assert.equal(result.success, true);
    assert.deepEqual(trashCalls, [stagedPath]);
    assert.equal(fs.exists(entryDir), false);
  });

  it('createQuitFlushGuard flushes once, does not loop, then allows cleanup', async () => {
    let flushCount = 0;
    let quitCount = 0;
    const guard = createQuitFlushGuard({
      flush: async () => {
        flushCount += 1;
      },
      quit: () => {
        quitCount += 1;
      },
    });

    const event1 = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    const first = await guard.run(event1);
    assert.equal(first, false);
    assert.equal(event1.prevented, true);
    assert.equal(flushCount, 1);
    assert.equal(quitCount, 1);
    assert.equal(guard.done, true);

    const event2 = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    const second = await guard.run(event2);
    assert.equal(second, true);
    assert.equal(event2.prevented, false);
    assert.equal(flushCount, 1);
    assert.equal(quitCount, 1);
  });

  it('same-second stages with same kind+recordId get unique tokens and independent restore/commit', async () => {
    await fs.writeFile(path.join(projectPath, 'locations', '_a.md'), 'content-a');
    await fs.writeFile(path.join(projectPath, 'locations', '_b.md'), 'content-b');

    const a = await manager.stage(projectPath, path.join(projectPath, 'locations', '_a.md'), {
      kind: 'location',
      recordId: 'same',
      name: 'A',
    });
    const b = await manager.stage(projectPath, path.join(projectPath, 'locations', '_b.md'), {
      kind: 'location',
      recordId: 'same',
      name: 'B',
    });

    assert.equal(a.success, true);
    assert.equal(b.success, true);
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.stagedPath, b.stagedPath);
    assert.equal(fs.read(a.stagedPath), 'content-a');
    assert.equal(fs.read(b.stagedPath), 'content-b');

    const restored = await manager.restore(a.token);
    assert.equal(restored.success, true);
    assert.equal(fs.read(path.join(projectPath, 'locations', '_a.md')), 'content-a');
    assert.equal(fs.exists(b.stagedPath), true);
    assert.equal(fs.read(b.stagedPath), 'content-b');

    await manager.commit(b.token);
    assert.deepEqual(trashCalls, [b.stagedPath]);
    assert.equal(fs.exists(path.join(projectPath, 'locations', '_a.md')), true);
  });

  it('rejects path-like kind/recordId without moving anything', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const beforeKeys = [...fs._store.keys()].sort();
    const cases = [
      { kind: 'location', recordId: '../../../escaped', name: 'X' },
      { kind: 'loc/evil', recordId: 'ok', name: 'X' },
      { kind: '', recordId: 'ok', name: 'X' },
      { kind: 'location', recordId: '', name: 'X' },
      { kind: 'location', recordId: '..\\escaped', name: 'X' },
    ];

    for (const meta of cases) {
      const result = await manager.stage(projectPath, target, meta);
      assert.equal(result.success, false, `expected reject for ${JSON.stringify(meta)}`);
      assert.ok(result.error);
      assert.equal(fs.read(target), 'harbour body');
      assert.deepEqual([...fs._store.keys()].sort(), beforeKeys);
    }

    // Nothing under or outside .ensemble-trash.
    assert.equal(fs.exists(path.join(projectPath, TRASH_DIR_NAME)), false);
    for (const key of fs._store.keys()) {
      assert.equal(String(key).includes('escaped'), false);
    }
  });

  it('shares one trashItem call across timer, trashCommit, and flush race', async () => {
    let releaseTrash;
    const gate = new Promise((resolve) => {
      releaseTrash = resolve;
    });
    let entered = 0;
    const rawRm = fs.rm.bind(fs);
    shell.trashItem = async (itemPath) => {
      trashCalls.push(itemPath);
      entered += 1;
      await gate;
      await rawRm(itemPath, { recursive: true, force: true });
    };

    const target = path.join(projectPath, 'locations', '_harbour.md');
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });
    assert.equal(staged.success, true);

    const timerHandle = timers.scheduled.find((h) => !h.cleared);
    assert.ok(timerHandle);
    timerHandle.cleared = true;

    const pTimer = timerHandle.fn();
    const pCommit = manager.commit(staged.token);
    const pFlush = manager.flushPending();

    // Wait until the single in-flight trashItem has started.
    for (let i = 0; i < 50 && entered === 0; i++) {
      await Promise.resolve();
    }
    assert.equal(entered, 1);
    releaseTrash();

    const results = await Promise.all([pTimer, pCommit, pFlush]);
    assert.equal(results[0].success, true);
    assert.equal(results[1].success, true);
    assert.equal(trashCalls.length, 1);
    assert.equal(failures.length, 0);
  });

  it('createQuitFlushGuard concurrent runs share one flush and one quit', async () => {
    let flushCount = 0;
    let quitCount = 0;
    let releaseFlush;
    const flushGate = new Promise((resolve) => {
      releaseFlush = resolve;
    });
    let flushEntered = 0;

    const guard = createQuitFlushGuard({
      flush: async () => {
        flushEntered += 1;
        flushCount += 1;
        await flushGate;
      },
      quit: () => {
        quitCount += 1;
      },
    });

    const event1 = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    const event2 = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };

    const p1 = guard.run(event1);
    // Let the first flush enter before starting the second run.
    for (let i = 0; i < 50 && flushEntered === 0; i++) {
      await Promise.resolve();
    }
    const p2 = guard.run(event2);

    assert.equal(event1.prevented, true);
    assert.equal(event2.prevented, true);

    releaseFlush();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, false);
    assert.equal(r2, false);
    assert.equal(flushCount, 1);
    assert.equal(quitCount, 1);
    assert.equal(guard.done, true);
  });

  it('restore rename failure re-arms the timer with remaining undo time', async () => {
    const target = path.join(projectPath, 'locations', '_harbour.md');
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });
    assert.equal(staged.success, true);

    const originalRename = fs.rename.bind(fs);
    fs.rename = async (from, to) => {
      if (String(from).includes(TRASH_DIR_NAME)) {
        throw new Error('parent folder gone');
      }
      return originalRename(from, to);
    };

    const result = await manager.restore(staged.token);
    assert.equal(result.success, false);
    assert.match(result.error, /parent folder gone/);
    assert.ok(
      manager.listPendingTokens().includes(staged.token),
      'entry remains pending'
    );
    assert.equal(fs.exists(staged.stagedPath), true);

    const armed = timers.scheduled.filter((h) => !h.cleared);
    assert.ok(armed.length >= 1, 'a commit timer is armed after failed restore');

    fs.rename = originalRename;
    trashCalls.length = 0;
    await timers.tick(UNDO_WINDOW_MS);
    assert.deepEqual(trashCalls, [staged.stagedPath]);
    assert.equal(manager.listPendingTokens().includes(staged.token), false);
  });
});

/**
 * Restore ↔ commit races against real temp dirs and a delayed fake shell.
 * Acceptance criteria from the restore-race card.
 */
describe('trash-manager restore/commit race (real temp dirs)', () => {
  const nodeFs = require('node:fs').promises;
  const os = require('node:os');
  const { afterEach } = require('node:test');

  let projectPath;
  let trashCalls;
  let failures;
  let manager;
  let timers;
  let releaseTrash;
  let trashGate;
  let trashEntered;
  /** Mutable wrapper around real fs so tests can gate access/rename. */
  let fs;

  function createRealFsWrapper() {
    return {
      mkdir: (...args) => nodeFs.mkdir(...args),
      rename: (...args) => nodeFs.rename(...args),
      writeFile: (...args) => nodeFs.writeFile(...args),
      readFile: (...args) => nodeFs.readFile(...args),
      access: (...args) => nodeFs.access(...args),
      unlink: (...args) => nodeFs.unlink(...args),
      rmdir: (...args) => nodeFs.rmdir(...args),
      rm: (...args) => nodeFs.rm(...args),
      readdir: (...args) => nodeFs.readdir(...args),
    };
  }

  async function setup(options = {}) {
    const { delayTrashItem = true } = options;
    projectPath = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'ensemble-trash-race-'));
    await nodeFs.mkdir(path.join(projectPath, 'locations'));
    const target = path.join(projectPath, 'locations', '_harbour.md');
    await nodeFs.writeFile(target, 'harbour body', 'utf8');

    trashCalls = [];
    failures = [];
    trashEntered = 0;
    trashGate = new Promise((resolve) => {
      releaseTrash = resolve;
    });
    fs = createRealFsWrapper();
    timers = createFakeTimers();

    manager = createTrashManager({
      fs,
      path,
      shell: {
        trashItem: async (itemPath) => {
          trashEntered += 1;
          trashCalls.push(itemPath);
          if (delayTrashItem) {
            await trashGate;
          }
          // Simulate OS trash: remove the staged item only (never recursive rm of wrapper).
          await nodeFs.rm(itemPath, { recursive: true, force: true });
        },
      },
      timers,
      assertPath: (p) => {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(path.resolve(projectPath))) {
          throw new Error('Path is outside the work folder and allowed directories');
        }
        return resolved;
      },
      emitCommitFailed: (payload) => failures.push(payload),
      now: () => Date.now(),
    });

    return target;
  }

  afterEach(async () => {
    if (projectPath) {
      await nodeFs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
      projectPath = null;
    }
  });

  async function stageHarbour(target) {
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });
    assert.equal(staged.success, true);
    // Disarm the auto-commit timer so races are driven explicitly.
    const entry = manager._getPendingEntry(staged.token);
    if (entry && entry.timer) {
      timers.clearTimeout(entry.timer);
      entry.timer = null;
    }
    return staged;
  }

  it('1. restore then commit same tick: restored, trashItem not called, no trash-commit-failed', async () => {
    const target = await setup();
    const staged = await stageHarbour(target);

    // Delay the first await inside restore (access) so commit observes `restoring`.
    const originalAccess = fs.access;
    let releaseAccess;
    const accessGate = new Promise((resolve) => {
      releaseAccess = resolve;
    });
    fs.access = async (...args) => {
      await accessGate;
      return originalAccess(...args);
    };

    const pRestore = manager.restore(staged.token);
    // Yield so restore parks on the gated access before commit starts.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    const pCommit = manager.commit(staged.token);
    releaseAccess();
    // Let restore finish; if commit raced without waiting, its delayed trashItem
    // would still be parked on trashGate — release it so a buggy commit can fail.
    releaseTrash();

    const [restoreResult, commitResult] = await Promise.all([pRestore, pCommit]);
    fs.access = originalAccess;

    assert.equal(restoreResult.success, true);
    assert.equal(await nodeFs.readFile(target, 'utf8'), 'harbour body');
    assert.equal(trashCalls.length, 0, 'trashItem must not run after a successful restore');
    assert.equal(failures.length, 0, 'no trash-commit-failed after successful restore');
    assert.equal(manager.listPendingTokens().includes(staged.token), false);
    assert.equal(commitResult.success, true);
  });

  it('2. commit then restore same tick: trashItem once, restore refused, no event', async () => {
    const target = await setup();
    const staged = await stageHarbour(target);

    const pCommit = manager.commit(staged.token);
    // Yield so commit can set `committing` and park inside delayed trashItem.
    for (let i = 0; i < 50 && trashEntered === 0; i++) {
      await Promise.resolve();
    }
    assert.equal(trashEntered, 1);

    const restoreResult = await manager.restore(staged.token);
    assert.equal(restoreResult.success, false);
    assert.equal(restoreResult.error, 'Trash entry commit already in progress');

    releaseTrash();
    const commitResult = await pCommit;
    assert.equal(commitResult.success, true);
    assert.equal(trashCalls.length, 1);
    assert.equal(failures.length, 0);
    // Original path stays empty — item went to (fake) OS trash.
    await assert.rejects(() => nodeFs.access(target), { code: 'ENOENT' });
  });

  it('3. flushPending during restore: restored, trashItem not called, no event', async () => {
    const target = await setup();
    const staged = await stageHarbour(target);

    const originalAccess = fs.access;
    let releaseAccess;
    const accessGate = new Promise((resolve) => {
      releaseAccess = resolve;
    });
    fs.access = async (...args) => {
      await accessGate;
      return originalAccess(...args);
    };

    const pRestore = manager.restore(staged.token);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    const pFlush = manager.flushPending();
    releaseAccess();
    releaseTrash();

    const [restoreResult] = await Promise.all([pRestore, pFlush]);
    fs.access = originalAccess;

    assert.equal(restoreResult.success, true);
    assert.equal(await nodeFs.readFile(target, 'utf8'), 'harbour body');
    assert.equal(trashCalls.length, 0, 'flush must not trashItem after a successful restore');
    assert.equal(failures.length, 0);
  });

  it('4. restore rename fails while commit waits → commit runs once afterwards', async () => {
    const target = await setup({ delayTrashItem: false });
    const staged = await stageHarbour(target);

    const originalRename = fs.rename;
    let renameAttempts = 0;
    let releaseRename;
    const renameGate = new Promise((resolve) => {
      releaseRename = resolve;
    });
    fs.rename = async (from, to) => {
      // Only gate the restore rename (staged → original).
      if (String(from).includes(TRASH_DIR_NAME) && path.resolve(to) === path.resolve(target)) {
        renameAttempts += 1;
        await renameGate;
        throw new Error('simulated restore rename failure');
      }
      return originalRename(from, to);
    };

    let restoreSettled = false;
    const pRestore = manager.restore(staged.token).then((result) => {
      restoreSettled = true;
      return result;
    });
    // access/rename are real I/O — wait with setImmediate, not only microtasks.
    const deadline = Date.now() + 2000;
    while (renameAttempts === 0 && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(renameAttempts, 1);

    // Commit must not call trashItem until the in-flight restore has settled.
    const originalTrashItem = manager._getPendingEntry(staged.token);
    assert.ok(originalTrashItem, 'entry still pending during restore');
    const pCommit = manager.commit(staged.token);
    // Give a buggy (non-waiting) commit a chance to race ahead of restore.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(
      trashCalls.length,
      0,
      'commit must wait for the in-flight restore before trashItem'
    );
    assert.equal(restoreSettled, false);

    releaseRename();

    const [restoreResult, commitResult] = await Promise.all([pRestore, pCommit]);
    fs.rename = originalRename;

    assert.equal(restoreResult.success, false);
    assert.match(restoreResult.error, /simulated restore rename failure/);
    assert.equal(commitResult.success, true);
    assert.equal(trashCalls.length, 1, 'commit must run once after the failed restore');
    assert.equal(failures.length, 0);
    assert.equal(manager.listPendingTokens().includes(staged.token), false);
  });
});

/**
 * Two concurrent restore() calls for the same token.
 * Acceptance criteria from the double-restore card (prefer join).
 * Shell.trashItem rejects with ENOENT when the staged path is already gone —
 * the failure mode that produced false trash-commit-failed on 1bb7e25.
 */
describe('trash-manager double restore (real temp dirs)', () => {
  const nodeFs = require('node:fs').promises;
  const os = require('node:os');
  const { afterEach } = require('node:test');

  let projectPath;
  let trashCalls;
  let failures;
  let manager;
  let timers;
  let fs;

  function createRealFsWrapper() {
    return {
      mkdir: (...args) => nodeFs.mkdir(...args),
      rename: (...args) => nodeFs.rename(...args),
      writeFile: (...args) => nodeFs.writeFile(...args),
      readFile: (...args) => nodeFs.readFile(...args),
      access: (...args) => nodeFs.access(...args),
      unlink: (...args) => nodeFs.unlink(...args),
      rmdir: (...args) => nodeFs.rmdir(...args),
      rm: (...args) => nodeFs.rm(...args),
      readdir: (...args) => nodeFs.readdir(...args),
    };
  }

  async function setup() {
    projectPath = await nodeFs.mkdtemp(
      path.join(os.tmpdir(), 'ensemble-trash-dblrestore-')
    );
    await nodeFs.mkdir(path.join(projectPath, 'locations'));
    const target = path.join(projectPath, 'locations', '_harbour.md');
    await nodeFs.writeFile(target, 'harbour body', 'utf8');

    trashCalls = [];
    failures = [];
    fs = createRealFsWrapper();
    timers = createFakeTimers();

    manager = createTrashManager({
      fs,
      path,
      shell: {
        trashItem: async (itemPath) => {
          trashCalls.push(itemPath);
          try {
            await nodeFs.access(itemPath);
          } catch (err) {
            const message =
              err && err.message
                ? err.message
                : `ENOENT: no such file or directory, access '${itemPath}'`;
            throw Object.assign(new Error(message), {
              code: 'ENOENT',
              path: itemPath,
            });
          }
          await nodeFs.rm(itemPath, { recursive: true, force: true });
        },
      },
      timers,
      assertPath: (p) => {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(path.resolve(projectPath))) {
          throw new Error('Path is outside the work folder and allowed directories');
        }
        return resolved;
      },
      emitCommitFailed: (payload) => failures.push(payload),
      now: () => Date.now(),
    });

    return target;
  }

  afterEach(async () => {
    if (projectPath) {
      await nodeFs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
      projectPath = null;
    }
  });

  async function stageHarbour(target, { keepTimer = false } = {}) {
    const staged = await manager.stage(projectPath, target, {
      kind: 'location',
      recordId: 'loc1',
      name: 'Harbour',
    });
    assert.equal(staged.success, true);
    if (!keepTimer) {
      const entry = manager._getPendingEntry(staged.token);
      if (entry && entry.timer) {
        timers.clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    return staged;
  }

  it('AC1: restore, restore, commit same tick → restored, no trashItem, no trash-commit-failed', async () => {
    const target = await setup();
    const staged = await stageHarbour(target);

    const p1 = manager.restore(staged.token);
    const p2 = manager.restore(staged.token);
    const pCommit = manager.commit(staged.token);

    const [r1, r2, commitResult] = await Promise.all([p1, p2, pCommit]);

    assert.equal(await nodeFs.readFile(target, 'utf8'), 'harbour body');
    assert.equal(trashCalls.length, 0, 'trashItem must not run after a successful restore');
    assert.equal(failures.length, 0, 'no trash-commit-failed after successful restore');
    assert.equal(commitResult.success, true);

    assert.equal(r1.success, true, 'first restore succeeds');
    // Joined second restore returns the same success (not raw ENOENT / not a toast-worthy error).
    assert.equal(r2.success, true, 'second restore joins and succeeds');
    assert.equal(
      r2.error,
      undefined,
      'joined restore must not surface a raw ENOENT rename error'
    );
    assert.equal(manager.listPendingTokens().includes(staged.token), false);
  });

  it('AC2: concurrent restores, first rename fails → marker held; commit once after both', async () => {
    const target = await setup();
    const staged = await stageHarbour(target);

    const originalRename = fs.rename;
    let renameAttempts = 0;
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let releaseSecond;
    const secondGate = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    fs.rename = async (from, to) => {
      if (
        String(from).includes(TRASH_DIR_NAME) &&
        path.resolve(to) === path.resolve(target)
      ) {
        renameAttempts += 1;
        if (renameAttempts === 1) {
          await firstGate;
          throw new Error('simulated first restore rename failure');
        }
        await secondGate;
        return originalRename(from, to);
      }
      return originalRename(from, to);
    };

    const p1 = manager.restore(staged.token);
    const deadline = Date.now() + 2000;
    while (renameAttempts === 0 && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(renameAttempts, 1);

    const entryDuringFirst = manager._getPendingEntry(staged.token);
    assert.ok(entryDuringFirst, 'entry still pending during first restore');
    assert.ok(entryDuringFirst.restoring, 'restoring marker set during first restore');
    const markerDuringFirst = entryDuringFirst.restoring;

    const p2 = manager.restore(staged.token);
    // Joined second restore must not start its own rename or clear the marker.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(
      renameAttempts,
      1,
      'joined second restore must not start a second rename'
    );
    const entryDuringSecond = manager._getPendingEntry(staged.token);
    assert.ok(entryDuringSecond, 'entry still pending while second restore awaits');
    assert.equal(
      entryDuringSecond.restoring,
      markerDuringFirst,
      'marker must not be overwritten or cleared while the second restore is in flight'
    );

    const pCommit = manager.commit(staged.token);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(
      trashCalls.length,
      0,
      'commit must wait until restores finish before trashItem'
    );

    releaseFirst();
    // If a buggy second rename was started, release it so the race can finish.
    releaseSecond();

    const [r1, r2, commitResult] = await Promise.all([p1, p2, pCommit]);
    fs.rename = originalRename;

    assert.equal(r1.success, false);
    assert.match(r1.error, /simulated first restore rename failure/);
    // Joined: same failure result (not a later ENOENT from a second rename).
    assert.equal(r2.success, false);
    assert.match(r2.error, /simulated first restore rename failure/);
    assert.equal(commitResult.success, true);
    assert.equal(trashCalls.length, 1, 'commit runs at most once, after both restores');
    assert.equal(failures.length, 0);
    assert.equal(manager.listPendingTokens().includes(staged.token), false);
  });

  it('AC3: no live commit timer remains after a successful restore', async () => {
    const target = await setup();
    // Keep the auto-commit timer so we can assert it is cleared on restore.
    const staged = await stageHarbour(target, { keepTimer: true });

    const before = timers.scheduled.filter((h) => !h.cleared);
    assert.ok(before.length >= 1, 'precondition: a live commit timer exists');

    const p1 = manager.restore(staged.token);
    const p2 = manager.restore(staged.token);
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(r1.success, true);
    assert.equal(await nodeFs.readFile(target, 'utf8'), 'harbour body');
    assert.equal(manager.listPendingTokens().includes(staged.token), false);

    // Primary AC3 check: a joined/failed second restore must not leave a live timer.
    const live = timers.scheduled.filter((h) => !h.cleared);
    assert.equal(
      live.length,
      0,
      'no live commit timer may remain after a successful restore (joined second must not re-arm)'
    );

    assert.equal(r2.success, true, 'second restore joins and succeeds');
    assert.equal(trashCalls.length, 0);
    assert.equal(failures.length, 0);

    // Ticking must not fire a stray commit against the restored path.
    await timers.tick(UNDO_WINDOW_MS);
    assert.equal(trashCalls.length, 0);
    assert.equal(failures.length, 0);
  });
});
