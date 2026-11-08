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
