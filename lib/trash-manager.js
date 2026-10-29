/**
 * Main-process trash staging: rename into `.ensemble-trash`, wait a short undo
 * window, then hand the item to the OS trash via `shell.trashItem`.
 *
 * Never falls back to a permanent delete (`fs.rm` / `unlink` of staged content).
 * Dependencies (fs, shell, path, timers) are injected so unit tests can fake them.
 */

const trashConstants = require('../trash-constants.json');

/** Undo window before OS trash commit. Shared with renderer via trash-constants.json. */
const UNDO_WINDOW_MS = trashConstants.UNDO_WINDOW_MS;

const TRASH_DIR_NAME = '.ensemble-trash';
const MANIFEST_NAME = 'manifest.json';

/**
 * @param {Date} date
 * @returns {string} yyyyMMdd-HHmmss
 */
function formatEntryTimestamp(date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Build entry id: `<yyyyMMdd-HHmmss>-<kind>-<recordId>`.
 * @param {{ kind: string, recordId: string, now?: () => number }} meta
 */
function buildEntryId(meta) {
  const nowMs = typeof meta.now === 'function' ? meta.now() : Date.now();
  const stamp = formatEntryTimestamp(new Date(nowMs));
  return `${stamp}-${meta.kind}-${meta.recordId}`;
}

/**
 * Quit-flush guard: preventDefault, await flush, then re-quit once.
 * Failed commits stay staged; the guard never loops.
 *
 * @param {{ flush: () => Promise<void>, quit: () => void }} deps
 */
function createQuitFlushGuard(deps) {
  const { flush, quit } = deps;
  let done = false;

  /**
   * @param {{ preventDefault: () => void }} event
   * @returns {Promise<boolean>} true when other quit cleanup should run
   */
  async function run(event) {
    if (done) {
      return true;
    }
    event.preventDefault();
    try {
      await flush();
    } finally {
      done = true;
      quit();
    }
    return false;
  }

  return {
    run,
    get done() {
      return done;
    },
    /** @param {boolean} [value] */
    _resetForTests(value = false) {
      done = Boolean(value);
    },
  };
}

/**
 * @param {object} deps
 * @param {import('fs').promises} deps.fs
 * @param {typeof import('path')} deps.path
 * @param {{ trashItem: (itemPath: string) => Promise<void> }} deps.shell
 * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} deps.timers
 * @param {(filePath: string) => string} deps.assertPath
 * @param {(payload: object) => void} [deps.emitCommitFailed]
 * @param {() => number} [deps.now]
 */
function createTrashManager(deps) {
  const {
    fs,
    path,
    shell,
    timers,
    assertPath,
    emitCommitFailed = () => {},
    now = () => Date.now(),
  } = deps;

  /** @type {Map<string, object>} */
  const pending = new Map();
  /** Tokens that were successfully handed to the OS trash. */
  const committedTokens = new Set();

  function trashRootFor(projectPath) {
    return path.join(projectPath, TRASH_DIR_NAME);
  }

  function entryDirFor(projectPath, token) {
    return path.join(trashRootFor(projectPath), token);
  }

  /**
   * Stage a folder or single .md file into `.ensemble-trash`.
   *
   * @param {string} projectPath
   * @param {string} targetPath
   * @param {{ kind: string, recordId: string, name: string }} meta
   */
  async function stage(projectPath, targetPath, meta) {
    try {
      if (!meta || typeof meta.kind !== 'string' || typeof meta.recordId !== 'string') {
        return { success: false, error: 'kind and recordId are required' };
      }
      if (typeof meta.name !== 'string') {
        return { success: false, error: 'name is required' };
      }

      const safeProject = assertPath(projectPath);
      const safeTarget = assertPath(targetPath);
      const basename = path.basename(safeTarget);
      const token = buildEntryId({ kind: meta.kind, recordId: meta.recordId, now });
      const entryDir = entryDirFor(safeProject, token);
      const stagedPath = path.join(entryDir, basename);
      const stagedAt = now();
      const expiresAt = stagedAt + UNDO_WINDOW_MS;

      await fs.mkdir(entryDir, { recursive: true });

      try {
        await fs.rename(safeTarget, stagedPath);
      } catch (renameError) {
        await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {});
        return {
          success: false,
          error: renameError && renameError.message ? renameError.message : String(renameError),
        };
      }

      const manifest = {
        kind: meta.kind,
        recordId: meta.recordId,
        name: meta.name,
        originalPath: safeTarget,
        stagedAt,
      };

      try {
        await fs.writeFile(
          path.join(entryDir, MANIFEST_NAME),
          JSON.stringify(manifest, null, 2),
          'utf8'
        );
      } catch (writeError) {
        // Best-effort rollback of the rename so the original path is restored.
        await fs.rename(stagedPath, safeTarget).catch(() => {});
        await fs.rm(entryDir, { recursive: true, force: true }).catch(() => {});
        return {
          success: false,
          error: writeError && writeError.message ? writeError.message : String(writeError),
        };
      }

      // Return the commit promise so injectable/fake timers can await it.
      const timer = timers.setTimeout(() => commit(token), UNDO_WINDOW_MS);

      pending.set(token, {
        token,
        projectPath: safeProject,
        entryDir,
        basename,
        stagedPath,
        originalPath: safeTarget,
        name: meta.name,
        kind: meta.kind,
        recordId: meta.recordId,
        stagedAt,
        expiresAt,
        timer,
        committed: false,
      });

      return { success: true, token, stagedPath, expiresAt };
    } catch (error) {
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  /**
   * Load a staged entry from disk when it is not in the in-memory map
   * (crash recovery / leftovers).
   * @param {string} projectPath
   * @param {string} token
   */
  async function loadEntryFromDisk(projectPath, token) {
    const safeProject = assertPath(projectPath);
    const entryDir = entryDirFor(safeProject, token);
    const manifestPath = path.join(entryDir, MANIFEST_NAME);
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const basename = path.basename(manifest.originalPath);
    const stagedPath = path.join(entryDir, basename);
    return {
      token,
      projectPath: safeProject,
      entryDir,
      basename,
      stagedPath,
      originalPath: manifest.originalPath,
      name: manifest.name,
      kind: manifest.kind,
      recordId: manifest.recordId,
      stagedAt: manifest.stagedAt,
      timer: null,
      committed: false,
      fromDisk: true,
    };
  }

  /**
   * Restore within the undo window: rename back to originalPath and cancel timer.
   * @param {string} token
   */
  async function restore(token) {
    try {
      if (committedTokens.has(token)) {
        return { success: false, error: 'Trash entry already committed' };
      }
      const entry = pending.get(token);
      if (!entry) {
        return { success: false, error: 'Unknown trash token' };
      }
      if (entry.committed) {
        return { success: false, error: 'Trash entry already committed' };
      }

      try {
        await fs.access(entry.originalPath);
        return { success: false, error: 'Original path already exists' };
      } catch {
        // originalPath does not exist — safe to restore.
      }

      if (entry.timer) {
        timers.clearTimeout(entry.timer);
        entry.timer = null;
      }

      await fs.rename(entry.stagedPath, entry.originalPath);
      await fs.unlink(path.join(entry.entryDir, MANIFEST_NAME)).catch(() => {});
      await fs.rmdir(entry.entryDir).catch(() => {});
      pending.delete(token);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  /**
   * Hand staged item to OS trash. On failure keep the entry and emit
   * trash-commit-failed — never permanently delete staged content.
   * @param {string} token
   * @param {{ projectPath?: string }} [options]
   */
  async function commit(token, options = {}) {
    if (committedTokens.has(token)) {
      return { success: false, error: 'Trash entry already committed' };
    }

    let entry = pending.get(token);

    if (entry && entry.committed) {
      return { success: false, error: 'Trash entry already committed' };
    }

    if (!entry && options.projectPath) {
      try {
        entry = await loadEntryFromDisk(options.projectPath, token);
        pending.set(token, entry);
      } catch (loadError) {
        return {
          success: false,
          error:
            loadError && loadError.message
              ? loadError.message
              : 'Unknown trash token',
        };
      }
    }

    if (!entry) {
      return { success: false, error: 'Unknown trash token' };
    }

    if (entry.timer) {
      timers.clearTimeout(entry.timer);
      entry.timer = null;
    }

    try {
      await shell.trashItem(entry.stagedPath);
    } catch (trashError) {
      const errorMessage =
        trashError && trashError.message ? trashError.message : String(trashError);
      emitCommitFailed({
        token,
        name: entry.name,
        stagedPath: entry.stagedPath,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }

    // trashItem succeeded — remove wrapper only (manifest + empty entry dir).
    // Do not fs.rm the staged basename; trashItem already moved it.
    entry.committed = true;
    committedTokens.add(token);
    await fs.unlink(path.join(entry.entryDir, MANIFEST_NAME)).catch(() => {});
    await fs.rmdir(entry.entryDir).catch(() => {});
    pending.delete(token);

    return { success: true };
  }

  /**
   * Commit every in-memory pending entry (quit / project switch).
   * Failed commits stay staged.
   */
  async function flushPending() {
    const tokens = [...pending.keys()];
    for (const token of tokens) {
      await commit(token);
    }
  }

  /**
   * Crash recovery: commit leftover `.ensemble-trash` entries on disk for a project.
   * @param {string} projectPath
   */
  async function commitLeftoversOnDisk(projectPath) {
    let safeProject;
    try {
      safeProject = assertPath(projectPath);
    } catch (error) {
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
      };
    }

    const trashRoot = trashRootFor(safeProject);
    let dirents;
    try {
      dirents = await fs.readdir(trashRoot, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { success: true };
      }
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
      };
    }

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const token = dirent.name;
      const existing = pending.get(token);
      if (existing && existing.timer) {
        timers.clearTimeout(existing.timer);
        existing.timer = null;
      }
      await commit(token, { projectPath: safeProject });
    }

    return { success: true };
  }

  /** @returns {string[]} */
  function listPendingTokens() {
    return [...pending.keys()];
  }

  return {
    stage,
    restore,
    commit,
    flushPending,
    commitLeftoversOnDisk,
    listPendingTokens,
    UNDO_WINDOW_MS,
    TRASH_DIR_NAME,
  };
}

module.exports = {
  UNDO_WINDOW_MS,
  TRASH_DIR_NAME,
  MANIFEST_NAME,
  buildEntryId,
  formatEntryTimestamp,
  createTrashManager,
  createQuitFlushGuard,
};
