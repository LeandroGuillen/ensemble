'use strict';
// Opening a project inside this checkout (e.g. examples/demo-project) must not leave
// untracked backup state, identity or snapshot zips behind in `git status`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createBackupManager } = require('../lib/backup-manager');

const repo = path.resolve(__dirname, '..');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
let inCheckout = false;
try { inCheckout = git(repo, 'rev-parse', '--is-inside-work-tree').trim() === 'true'; } catch { /* not a git checkout */ }
const skip = inCheckout ? false : 'not a git checkout';

/** Paths `git check-ignore` reports as ignored (exit 1 = none of them). */
function ignored(cwd, paths) {
  try {
    return git(cwd, 'check-ignore', '--no-index', ...paths).split('\n').filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

test('.ensemble-backup/ and ensemble-backups/ are ignored at any depth', { skip }, () => {
  const paths = [
    'examples/demo-project/.ensemble-backup/state.json',
    'examples/demo-project/.ensemble-backup/identity',
    'examples/demo-project/.ensemble-backup/identity-aliases',
    'examples/demo-project/.ensemble-backup/snapshots/ensemble-auto-backup-20261108-120000.zip',
    'examples/ensemble-backups/ensemble-backup-20261108-120000.zip',
    '.ensemble-backup/state.json',
    'some/nested/project/.ensemble-backup/identity',
  ];
  assert.deepEqual(ignored(repo, paths), paths);
});

test('no .ensemble-backup or ensemble-backups file is tracked', { skip }, () => {
  const tracked = git(repo, 'ls-files').split('\n')
    .filter(f => f.split('/').some(s => s === '.ensemble-backup' || s === 'ensemble-backups'));
  assert.deepEqual(tracked, []);
});

test('opening the demo in a checkout and an update snapshot leave git status clean', { skip }, async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ensemble-gitignore-'));
  try {
    // A throwaway checkout: the repo's real .gitignore plus a copy of the committed demo.
    const demo = path.join(tmp, 'examples', 'demo-project');
    await fsp.copyFile(path.join(repo, '.gitignore'), path.join(tmp, '.gitignore'));
    await fsp.cp(path.join(repo, 'examples', 'demo-project'), demo, { recursive: true });
    git(tmp, 'init', '-q');
    git(tmp, 'add', '-A');
    git(tmp, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');

    const manager = createBackupManager({ fs, path });
    const first = await manager.maybeAutoSnapshotBeforeMigration(demo, { currentAppVersion: '1.0.0' });
    assert.equal(first.reason, 'first-open');
    const update = await manager.maybeAutoSnapshotBeforeMigration(demo, { currentAppVersion: '1.0.1' });
    assert.equal(update.reason, 'migrated');
    assert.ok(update.snapshot.path.startsWith(path.join(demo, '.ensemble-backup', 'snapshots') + path.sep));
    assert.ok(fs.existsSync(update.snapshot.path));
    assert.ok(fs.existsSync(path.join(demo, '.ensemble-backup', 'state.json')));
    assert.ok(fs.existsSync(path.join(demo, '.ensemble-backup', 'identity')));

    assert.equal(git(tmp, 'status', '--porcelain', '--untracked-files=all'), '');
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('opening the committed demo through the app, navigating and an update snapshot leave the checkout clean', { skip }, async () => {
  // Reviewer probe: open examples/demo-project in place, let the app migrate legacy data and
  // remember navigation, then take an update snapshot; `git status` must stay clean.
  const { register } = require('../lib/dialog-handlers');
  const { setWorkFolder } = require('../lib/path-guard');
  const { ok, err } = require('../lib/ipc-result');
  const IPC = require('../ipc-channels.json');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ensemble-demo-open-'));
  try {
    const checkout = path.join(tmp, 'checkout');
    const demo = path.join(checkout, 'examples', 'demo-project');
    await fsp.mkdir(checkout);
    await fsp.copyFile(path.join(repo, '.gitignore'), path.join(checkout, '.gitignore'));
    for (const file of git(repo, 'ls-files', '-z', 'examples/demo-project').split('\0').filter(Boolean)) {
      await fsp.mkdir(path.dirname(path.join(checkout, file)), { recursive: true });
      await fsp.copyFile(path.join(repo, file), path.join(checkout, file));
    }
    git(checkout, 'init', '-q');
    git(checkout, 'add', '-A');
    git(checkout, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');

    let version = '1.0.0';
    const userData = path.join(tmp, 'userData');
    const handlers = new Map();
    register({ handle: (channel, fn) => handlers.set(channel, fn) }, {
      dialog: {}, getMainWindow: () => null, fs: fsp, path, IPC, ok, err,
      recentProjectsPath: path.join(userData, 'recent-projects.json'),
      app: { getVersion: () => version, getPath: (name) => { assert.equal(name, 'userData'); return userData; } },
      backupManager: createBackupManager({ fs, path }),
    });
    const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
    // The folder the app opens for a picked path (before the fix: the picked folder itself).
    const resolveOpen = async (picked) => handlers.has(IPC.resolveProjectFolder)
      ? invoke(IPC.resolveProjectFolder, picked)
      : { success: true, path: picked, demoCopy: false };

    const opened = await resolveOpen(demo);
    assert.equal(opened.success, true, opened.error);
    const project = opened.path;
    assert.equal((await invoke(IPC.setWorkFolder, project)).success, true);

    // What the app writes into the project it opened (seen by the reviewer in the checkout).
    const mara = path.join(project, 'characters', 'mara-vell', 'mara-vell.md');
    await fsp.writeFile(mara, (await fsp.readFile(mara, 'utf8')).replace(/^prompts:\n(?: {2}.*\n)+/m, ''));
    await fsp.mkdir(path.join(project, 'prompts', 'characters'), { recursive: true });
    await fsp.writeFile(path.join(project, 'prompts', 'characters', 'Mara Vell.md'), '# Keeper portrait\n');
    const metadata = JSON.parse(await fsp.readFile(path.join(project, 'ensemble.json'), 'utf8'));
    metadata.lastSession = { ...metadata.lastSession, lastRoute: '/locations' };
    await fsp.writeFile(path.join(project, 'ensemble.json'), JSON.stringify(metadata, null, 2));

    // A later app version reopens the same folder (picked again from the checkout) and snapshots it.
    version = '1.0.1';
    const reopened = await resolveOpen(demo);
    assert.equal(reopened.path, project);
    assert.equal((await invoke(IPC.setWorkFolder, reopened.path)).success, true);
    const snapshots = await fsp.readdir(path.join(project, '.ensemble-backup', 'snapshots'));
    assert.equal(snapshots.length, 1, 'update snapshot taken in the opened folder');

    assert.equal(git(checkout, 'status', '--porcelain', '--untracked-files=all', '--ignored'), '');
    // The work went to the writable copy outside the checkout, and it persists there.
    assert.equal(opened.demoCopy, true);
    assert.ok(path.relative(checkout, project).startsWith('..'), `opened inside the checkout: ${project}`);
    assert.equal(JSON.parse(await fsp.readFile(path.join(project, 'ensemble.json'), 'utf8')).lastSession.lastRoute, '/locations');
  } finally {
    setWorkFolder(null);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('the committed demo carries the marker that makes the app open a copy', { skip }, () => {
  assert.ok(git(repo, 'ls-files', 'examples/demo-project/.ensemble-demo').trim(), 'examples/demo-project/.ensemble-demo is not tracked');
});
