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

/** Allowed kind / recordId: non-empty, max 128, no path separators. */
const KIND_RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ENTRY_DIR_ATTEMPTS = 32;

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
 * @param {string} value
 * @param {string} label
 * @returns {string|null} error message, or null when valid
 */
function validateKindOrRecordId(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    return `${label} must be a non-empty string`;
  }
  if (value.length > 128) {
    return `${label} must be at most 128 characters`;
  }
  if (!KIND_RECORD_ID_PATTERN.test(value)) {
    return `${label} must match [A-Za-z0-9_-]{1,128}`;
  }
  return null;
}

/**
 * Build entry id: `<yyyyMMdd-HHmmss>-<kind>-<recordId>-<uniqueSuffix>`.
 * The suffix makes tokens unique even when kind+recordId collide in the same second.
 *
 * @param {{ kind: string, recordId: string, now?: () => number, suffix: string|number }} meta
 */
function buildEntryId(meta) {
  const nowMs = typeof meta.now === 'function' ? meta.now() : Date.now();
  const stamp = formatEntryTimestamp(new Date(nowMs));
  return `${stamp}-${meta.kind}-${meta.recordId}-${meta.suffix}`;
}

/**
 * Quit-flush guard: preventDefault, await a single in-flight flush, quit once.
 * Concurrent before-quit callers share the same flush promise; quit is not looped.
 *
 * @param {{ flush: () => Promise<void>, quit: () => void }} deps
 */
function createQuitFlushGuard(deps) {
  const { flush, quit } = deps;
  let done = false;
  /** @type {Promise<void>|null} */
  let inFlight = null;
  let quitCalled = false;

  /**
   * @param {{ preventDefault: () => void }} event
   * @returns {Promise<boolean>} true when other quit cleanup should run
   */
  async function run(event) {
    if (done) {
      return true;
    }
    // Always cancel this before-quit invocation while flush is outstanding.
    event.preventDefault();

    if (!inFlight) {
      inFlight = (async () => {
        try {
          await flush();
        } finally {
          done = true;
          if (!quitCalled) {
            quitCalled = true;
            quit();
          }
        }
      })();
    }

    await inFlight;
    return false;
  }

  return {
    run,
    get done() {
      return done;
    },
    get inFlight() {
      return inFlight;
    },
    /** @param {boolean} [value] */
    _resetForTests(value = false) {
      done = Boolean(value);
      inFlight = null;
      quitCalled = Boolean(value);
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
  /** Monotonic suffix so same-second stages never reuse an entryId. */
  let entrySeq = 0;

  function trashRootFor(projectPath) {
    return path.join(projectPath, TRASH_DIR_NAME);
  }

  function entryDirFor(projectPath, token) {
    return path.join(trashRootFor(projectPath), token);
  }

  function armCommitTimer(entry, delayMs) {
    const delay = Math.max(1, delayMs);
    entry.timer = timers.setTimeout(() => commit(entry.token), delay);
  }

  /**
   * Create a unique entry directory directly under `.ensemble-trash`.
   * Uses exclusive mkdir (no recursive) so an existing dir fails with EEXIST.
   *
   * @param {string} safeProject
   * @param {{ kind: string, recordId: string }} meta
   */
  async function createExclusiveEntryDir(safeProject, meta) {
    const trashRoot = trashRootFor(safeProject);
    await fs.mkdir(trashRoot, { recursive: true });

    for (let attempt = 0; attempt < MAX_ENTRY_DIR_ATTEMPTS; attempt++) {
      entrySeq += 1;
      const token = buildEntryId({
        kind: meta.kind,
        recordId: meta.recordId,
        now,
        suffix: entrySeq,
      });
      const entryDir = entryDirFor(safeProject, token);

      if (path.resolve(path.dirname(entryDir)) !== path.resolve(trashRoot)) {
        return {
          success: false,
          error: 'Refusing trash entry path outside .ensemble-trash',
        };
      }

      try {
        await fs.mkdir(entryDir);
        return { success: true, token, entryDir, trashRoot };
      } catch (mkdirError) {
        if (mkdirError && mkdirError.code === 'EEXIST') {
          continue;
        }
        return {
          success: false,
          error:
            mkdirError && mkdirError.message
              ? mkdirError.message
              : String(mkdirError),
        };
      }
    }

    return {
      success: false,
      error: 'Could not allocate a unique trash entry directory',
    };
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
      if (!meta || typeof meta !== 'object') {
        return { success: false, error: 'kind and recordId are required' };
      }
      if (typeof meta.name !== 'string') {
        return { success: false, error: 'name is required' };
      }

      const kindError = validateKindOrRecordId(meta.kind, 'kind');
      if (kindError) {
        return { success: false, error: kindError };
      }
      const recordIdError = validateKindOrRecordId(meta.recordId, 'recordId');
      if (recordIdError) {
        return { success: false, error: recordIdError };
      }

      const safeProject = assertPath(projectPath);
      const safeTarget = assertPath(targetPath);
      const basename = path.basename(safeTarget);
      const stagedAt = now();
      const expiresAt = stagedAt + UNDO_WINDOW_MS;

      const allocated = await createExclusiveEntryDir(safeProject, {
        kind: meta.kind,
        recordId: meta.recordId,
      });
      if (!allocated.success) {
        return { success: false, error: allocated.error };
      }

      const { token, entryDir } = allocated;
      const stagedPath = path.join(entryDir, basename);

      try {
        await fs.rename(safeTarget, stagedPath);
      } catch (renameError) {
        // Rename never moved the target; entryDir should be empty — never recursive rm.
        await fs.rmdir(entryDir).catch(() => {});
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
        const writeMsg =
          writeError && writeError.message ? writeError.message : String(writeError);
        // Rollback the rename only when it succeeds. Never fs.rm the entry while
        // it still holds the staged item. Do not register pending/timer — staging
        // failed without a manifest; auto-commit would be unexpected. The caller
        // is told where the item remains so it can be recovered manually.
        let restored = false;
        try {
          await fs.rename(stagedPath, safeTarget);
          restored = true;
        } catch {
          restored = false;
        }
        if (restored) {
          await fs.rmdir(entryDir).catch(() => {});
          return { success: false, error: writeMsg };
        }
        return {
          success: false,
          error: `${writeMsg}; item remains staged at ${stagedPath}`,
        };
      }

      const entry = {
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
        timer: null,
        committed: false,
        /** @type {Promise<object>|null} */
        committing: null,
      };
      // Return the commit promise so injectable/fake timers can await it.
      armCommitTimer(entry, UNDO_WINDOW_MS);
      pending.set(token, entry);

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
    const trashRoot = trashRootFor(safeProject);
    const entryDir = entryDirFor(safeProject, token);

    if (path.resolve(path.dirname(entryDir)) !== path.resolve(trashRoot)) {
      throw new Error('Refusing trash entry path outside .ensemble-trash');
    }

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
      expiresAt:
        typeof manifest.stagedAt === 'number'
          ? manifest.stagedAt + UNDO_WINDOW_MS
          : now() + UNDO_WINDOW_MS,
      timer: null,
      committed: false,
      committing: null,
      fromDisk: true,
    };
  }

  /**
   * Restore within the undo window: rename back to originalPath.
   * Timer is cleared only after a successful rename; on failure it is re-armed
   * with the remaining undo time (`expiresAt - now()`, at least 1ms).
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
      if (entry.committing) {
        return { success: false, error: 'Trash entry commit already in progress' };
      }

      try {
        await fs.access(entry.originalPath);
        return { success: false, error: 'Original path already exists' };
      } catch {
        // originalPath does not exist — safe to restore.
      }

      // Pause the timer for the duration of the rename attempt.
      if (entry.timer) {
        timers.clearTimeout(entry.timer);
        entry.timer = null;
      }

      try {
        await fs.rename(entry.stagedPath, entry.originalPath);
      } catch (renameError) {
        // Re-arm with remaining undo window so the entry still commits later.
        const remaining = Math.max(1, entry.expiresAt - now());
        armCommitTimer(entry, remaining);
        return {
          success: false,
          error:
            renameError && renameError.message
              ? renameError.message
              : String(renameError),
        };
      }

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
   * Hand staged item to OS trash. Concurrent callers (timer, trashCommit,
   * flushPending, leftovers) share one in-flight `committing` promise so
   * shell.trashItem runs at most once per entry.
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

    if (entry.committing) {
      return entry.committing;
    }

    entry.committing = runCommit(entry);
    try {
      return await entry.committing;
    } finally {
      const still = pending.get(token);
      if (still) {
        still.committing = null;
      }
    }
  }

  /**
   * @param {object} entry
   */
  async function runCommit(entry) {
    const token = entry.token;

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

  /** Test helper: pending entry snapshot. */
  function _getPendingEntry(token) {
    return pending.get(token) || null;
  }

  return {
    stage,
    restore,
    commit,
    flushPending,
    commitLeftoversOnDisk,
    listPendingTokens,
    _getPendingEntry,
    UNDO_WINDOW_MS,
    TRASH_DIR_NAME,
  };
}

module.exports = {
  UNDO_WINDOW_MS,
  TRASH_DIR_NAME,
  MANIFEST_NAME,
  KIND_RECORD_ID_PATTERN,
  buildEntryId,
  formatEntryTimestamp,
  validateKindOrRecordId,
  createTrashManager,
  createQuitFlushGuard,
};
