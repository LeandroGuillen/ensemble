const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { register } = require('./fs-handlers');
const IPC = require('../ipc-channels.json');
const { ok, err } = require('./ipc-result');

for (const scenario of ['success', 'conflict', 'write failure']) {
  test(`wiki-link batch: ${scenario}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ensemble-rename-'));
    try {
      const a = path.join(root, 'a.md');
      const b = path.join(root, 'b.md');
      await fs.writeFile(a, '[[Old|label]]');
      await fs.writeFile(b, scenario === 'conflict' ? 'external edit' : '[[Old]]');
      const handlers = new Map();
      const wrappedFs = { ...fs, rename: async (from, to) => {
        if (scenario === 'write failure' && to === b) throw new Error('disk failure');
        return fs.rename(from, to);
      } };
      register({ handle: (key, handler) => handlers.set(key, handler) }, { fs: wrappedFs, path, IPC, ok, err, assertPath: p => p, shell: {} });
      const handler = handlers.get(IPC.rewriteWikiLinks);
      assert.equal(typeof handler, 'function');
      const result = await handler({}, [
        { path: a, expected: '[[Old|label]]', content: '[[New|label]]' },
        { path: b, expected: '[[Old]]', content: '[[New]]' },
      ]);
      assert.equal(result.success, scenario === 'success');
      assert.equal(await fs.readFile(a, 'utf8'), scenario === 'success' ? '[[New|label]]' : '[[Old|label]]');
      assert.equal(await fs.readFile(b, 'utf8'), scenario === 'success' ? '[[New]]' : scenario === 'conflict' ? 'external edit' : '[[Old]]');
      assert.deepEqual((await fs.readdir(root)).sort(), ['a.md', 'b.md']);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
