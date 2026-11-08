'use strict';
// The committed demo (examples/demo-project) carries a marker file. Opening it while it
// sits inside a git checkout opens a writable copy under userData instead, so the app's
// writes (ensemble.json lastSession, data migrations, .ensemble-backup/) never touch the
// checkout. Copies made by hand outside a checkout open in place, as before.

const DEMO_MARKER_FILE = '.ensemble-demo';
const DEMO_COPIES_FOLDER = 'demo-projects';
/** Never carried into the copy: the marker itself and per-project local state. */
const SKIPPED_NAMES = new Set([DEMO_MARKER_FILE, '.ensemble-backup', '.ensemble-trash', 'ensemble-backups', '.git']);

async function exists(fs, target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** True when `folder` or one of its parents holds a `.git` entry (folder or worktree file). */
async function isInsideGitCheckout(fs, path, folder) {
  let current = path.resolve(folder);
  for (;;) {
    if (await exists(fs, path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Returns the folder the app should open for `folderPath`: the folder itself, or, for the
 * committed demo inside a git checkout, its copy under `<copiesRoot>/<folder name>`
 * (created on first open and reused afterwards so edits to it persist).
 *
 * @returns {Promise<{ path: string, demoCopy: boolean, created: boolean }>}
 */
async function resolveProjectOpenPath(folderPath, { fs, path, copiesRoot }) {
  const source = path.resolve(folderPath);
  if (!(await exists(fs, path.join(source, DEMO_MARKER_FILE)))) {
    return { path: folderPath, demoCopy: false, created: false };
  }
  if (!(await isInsideGitCheckout(fs, path, source))) {
    return { path: folderPath, demoCopy: false, created: false };
  }

  const dest = path.join(copiesRoot, path.basename(source));
  if (await exists(fs, dest)) {
    return { path: dest, demoCopy: true, created: false };
  }

  // Copy beside the destination first, then rename, so a half-written copy is never reused.
  await fs.mkdir(copiesRoot, { recursive: true });
  const partial = `${dest}.partial-${process.pid}-${Date.now()}`;
  try {
    await fs.cp(source, partial, {
      recursive: true,
      filter: (src) => src === source || !SKIPPED_NAMES.has(path.basename(src)),
    });
    await fs.rename(partial, dest);
  } catch (error) {
    await fs.rm(partial, { recursive: true, force: true }).catch(() => {});
    // Another window may have finished the same copy first.
    if (await exists(fs, dest)) return { path: dest, demoCopy: true, created: false };
    throw error;
  }
  return { path: dest, demoCopy: true, created: true };
}

module.exports = {
  DEMO_MARKER_FILE,
  DEMO_COPIES_FOLDER,
  isInsideGitCheckout,
  resolveProjectOpenPath,
};
