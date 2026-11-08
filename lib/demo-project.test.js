'use strict';
// The committed demo opened from a git checkout resolves to a writable copy under userData.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveProjectOpenPath, isInsideGitCheckout, DEMO_MARKER_FILE } = require('./demo-project');

async function makeDemo(root, { git }) {
  const checkout = path.join(root, 'checkout');
  const demo = path.join(checkout, 'examples', 'demo-project');
  await fsp.mkdir(path.join(demo, 'characters', 'mara-vell'), { recursive: true });
  if (git) await fsp.mkdir(path.join(checkout, '.git'));
  await fsp.writeFile(path.join(demo, 'ensemble.json'), '{"projectName":"Demo"}\n');
  await fsp.writeFile(path.join(demo, 'characters', 'mara-vell', 'mara-vell.md'), '---\nname: Mara Vell\n---\n');
  await fsp.writeFile(path.join(demo, DEMO_MARKER_FILE), 'demo marker\n');
  await fsp.mkdir(path.join(demo, '.ensemble-backup'), { recursive: true });
  await fsp.writeFile(path.join(demo, '.ensemble-backup', 'identity'), 'checkout-identity\n');
  await fsp.mkdir(path.join(demo, '.ensemble-trash', 'entry'), { recursive: true });
  await fsp.writeFile(path.join(demo, '.ensemble-trash', 'entry', 'manifest.json'), '{}');
  return demo;
}

async function withTmp(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ensemble-demo-open-'));
  try {
    return await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test('the committed demo inside a git checkout opens as a copy without the marker or local state', () => withTmp(async (root) => {
  const demo = await makeDemo(root, { git: true });
  const copiesRoot = path.join(root, 'userData', 'demo-projects');

  const first = await resolveProjectOpenPath(demo, { fs: fsp, path, copiesRoot });

  assert.deepEqual(first, { path: path.join(copiesRoot, 'demo-project'), demoCopy: true, created: true });
  assert.equal(fs.readFileSync(path.join(first.path, 'ensemble.json'), 'utf8'), '{"projectName":"Demo"}\n');
  assert.ok(fs.existsSync(path.join(first.path, 'characters', 'mara-vell', 'mara-vell.md')));
  for (const local of [DEMO_MARKER_FILE, '.ensemble-backup', '.ensemble-trash']) {
    assert.equal(fs.existsSync(path.join(first.path, local)), false, `${local} copied`);
  }
  assert.deepEqual(fs.readdirSync(copiesRoot), ['demo-project'], 'no partial copy left behind');

  // Edits to the copy persist: the next open reuses it instead of copying again.
  await fsp.writeFile(path.join(first.path, 'ensemble.json'), '{"projectName":"Edited"}\n');
  const second = await resolveProjectOpenPath(demo, { fs: fsp, path, copiesRoot });
  assert.deepEqual(second, { path: first.path, demoCopy: true, created: false });
  assert.equal(fs.readFileSync(path.join(second.path, 'ensemble.json'), 'utf8'), '{"projectName":"Edited"}\n');
  assert.equal(fs.readFileSync(path.join(demo, 'ensemble.json'), 'utf8'), '{"projectName":"Demo"}\n');
}));

test('a demo copied outside any git checkout, and an ordinary project, open in place', () => withTmp(async (root) => {
  const copiesRoot = path.join(root, 'userData', 'demo-projects');
  const demo = await makeDemo(root, { git: false });
  // os.tmpdir() could itself sit inside a checkout; this case only means something when it does not.
  if (await isInsideGitCheckout(fsp, path, demo)) return;
  assert.deepEqual(await resolveProjectOpenPath(demo, { fs: fsp, path, copiesRoot }), { path: demo, demoCopy: false, created: false });

  const plain = path.join(root, 'plain');
  await fsp.mkdir(path.join(plain, '.git'), { recursive: true });
  assert.deepEqual(await resolveProjectOpenPath(plain, { fs: fsp, path, copiesRoot }), { path: plain, demoCopy: false, created: false });
  assert.equal(fs.existsSync(copiesRoot), false);
}));

test('a git worktree (.git file) counts as a checkout', () => withTmp(async (root) => {
  const worktree = path.join(root, 'wt');
  await fsp.mkdir(path.join(worktree, 'examples', 'demo-project'), { recursive: true });
  await fsp.writeFile(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
  assert.equal(await isInsideGitCheckout(fsp, path, path.join(worktree, 'examples', 'demo-project')), true);
}));
