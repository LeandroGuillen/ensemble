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
      const manifestPath = path.join(entryDir, MANIFEST_NAME);

      const manifest = {
        kind: meta.kind,
        recordId: meta.recordId,
        name: meta.name,
        originalPath: safeTarget,
        stagedAt,
      };

      // Manifest FIRST: a crash between the manifest write and the staging
      // rename leaves at most a manifest without an item (cleaned up on the
      // next open) — never an item without a manifest.
      try {
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      } catch (writeError) {
        const writeMsg =
          writeError && writeError.message ? writeError.message : String(writeError);
        // Nothing was staged: the target still sits at its original location,
        // so only the (partial) manifest and the empty wrapper are dropped.
        // Never recursive rm.
        await fs.unlink(manifestPath).catch(() => {});
        await fs.rmdir(entryDir).catch(() => {});
        return { success: false, error: writeMsg };
      }

      try {
        await fs.rename(safeTarget, stagedPath);
      } catch (renameError) {
        // The rename never moved the target; unlink the manifest we wrote and
        // drop the wrapper. Never fs.rm inside the entry while the item could
        // be there — here it still is at its original path.
        await fs.unlink(manifestPath).catch(() => {});
        await fs.rmdir(entryDir).catch(() => {});
        return {
          success: false,
          error: renameError && renameError.message ? renameError.message : String(renameError),
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
        /** @type {Promise<void>|null} resolves when an in-flight restore finishes */
        restoring: null,
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
      restoring: null,
      fromDisk: true,
    };
  }

  /**
   * Restore within the undo window: rename back to originalPath.
   *
   * Concurrency:
   * - Sets `entry.restoring` to the in-flight **result** promise synchronously
   *   before any await, so concurrent commits wait on it.
   * - A second `restore` for the same token **joins** that promise (same
   *   success/failure result). It does not overwrite the marker, clear it,
   *   re-arm the commit timer, or touch the timer. Prefer join over a
   *   'restore already in progress' error so duplicate Undo clicks in the
   *   renderer do not show a spurious error toast.
   * - Only the owner clears the marker: `if (entry.restoring === mine)`.
   *
   * Timer: cleared before the rename attempt; re-armed with remaining undo
   * time only on a failed rename (or commit-in-progress after clear). A
   * successful restore deletes the entry with no live commit timer left.
   * Re-checks `committing` immediately before the rename.
   * @param {string} token
   * @returns {Promise<{ success: boolean, error?: string }>}
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

      // Join an in-flight restore (double Undo). Do not touch timers/marker.
      if (entry.restoring) {
        return await entry.restoring;
      }

      const mine = runRestore(entry);
      entry.restoring = mine;
      try {
        return await mine;
      } finally {
        if (entry.restoring === mine) {
          entry.restoring = null;
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  /**
   * Body of a single restore attempt. Caller owns `entry.restoring`.
   * @param {object} entry
   */
  async function runRestore(entry) {
    const token = entry.token;

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

    // A commit may have started after our first check (e.g. same-tick race).
    if (entry.committing) {
      const remaining = Math.max(1, entry.expiresAt - now());
      armCommitTimer(entry, remaining);
      return {
        success: false,
        error: 'Trash entry commit already in progress',
      };
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

    // Success: ensure no commit timer remains on this entry.
    if (entry.timer) {
      timers.clearTimeout(entry.timer);
      entry.timer = null;
    }

    await fs.unlink(path.join(entry.entryDir, MANIFEST_NAME)).catch(() => {});
    await fs.rmdir(entry.entryDir).catch(() => {});
    pending.delete(token);

    return { success: true };
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

    // Wait out an in-flight restore. Success removes the entry → silent no-op
    // (no trashItem, no trash-commit-failed). Failure leaves the entry for us.
    while (entry && entry.restoring) {
      await entry.restoring;
      entry = pending.get(token);
    }

    if (!entry) {
      // Restored successfully (or otherwise dropped) while we waited.
      return { success: true };
    }

    if (entry.committed || committedTokens.has(token)) {
      return { success: false, error: 'Trash entry already committed' };
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

    // Item missing (manifest without an item, e.g. loaded from disk after a
    // crash between the manifest write and the staging rename): there is
    // nothing left to hand to the OS trash — just clean the manifest-only
    // wrapper and report success. Calling trashItem on the missing path
    // would fail and raise a false trash-commit-failed.
    let stagedMissing = false;
    if (entry.fromDisk) {
      try {
        await fs.access(entry.stagedPath);
      } catch (accessError) {
        if (accessError && accessError.code === 'ENOENT') {
          stagedMissing = true;
        } else {
          const errorMessage =
            accessError && accessError.message
              ? accessError.message
              : String(accessError);
          emitCommitFailed({
            token,
            name: entry.name,
            stagedPath: entry.stagedPath,
            error: errorMessage,
          });
          return { success: false, error: errorMessage };
        }
      }
    }

    if (!stagedMissing) {
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
   * Read and parse `manifest.json` inside an entry dir.
   * @param {string} entryDir
   * @returns {Promise<boolean>} true when a readable, valid-JSON manifest exists
   */
  async function manifestIsReadable(entryDir) {
    try {
      const raw = await fs.readFile(path.join(entryDir, MANIFEST_NAME), 'utf8');
      const manifest = JSON.parse(raw);
      // Valid JSON of the wrong shape (for example `{}`) is as unusable as a
      // corrupt file: loadEntryFromDisk needs a string originalPath.
      return Boolean(manifest) && typeof manifest.originalPath === 'string';
    } catch {
      return false;
    }
  }

  /**
   * Commit an entry whose manifest is missing or corrupt: hand every
   * non-manifest child to the OS trash via `shell.trashItem` (never fs.rm), then
   * remove the wrapper only after that succeeded. An entry without children
   * (or with only its manifest) just has its wrapper removed. On any failure
   * the content stays and `trash-commit-failed` is emitted with the entry path
   * (name = dir name, since the manifest that held the display name is gone).
   *
   * @param {string} token
   * @param {string} entryDir
   */
  async function commitOrphanEntry(token, entryDir) {
    try {
      const children = (await fs.readdir(entryDir)).filter(
        (name) => name !== MANIFEST_NAME
      );
      for (const child of children) {
        await shell.trashItem(path.join(entryDir, child));
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      emitCommitFailed({
        token,
        name: token,
        stagedPath: entryDir,
        entryPath: entryDir,
        error: message,
      });
      return { success: false, error: message };
    }

    // trashItem succeeded for every child — now the wrapper can go.
    await fs.unlink(path.join(entryDir, MANIFEST_NAME)).catch(() => {});
    await fs.rmdir(entryDir).catch(() => {});
    return { success: true };
  }

  /**
   * Crash recovery: commit leftover `.ensemble-trash` entries on disk for a project.
   * Entries with a missing or corrupt `manifest.json` are handled too:
   * their children are trashed individually and the wrapper removed.
   * When the trash root ends up empty, it is removed with rmdir — never recursive.
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
      const entryDir = entryDirFor(safeProject, token);
      const existing = pending.get(token);
      if (existing && existing.timer) {
        timers.clearTimeout(existing.timer);
        existing.timer = null;
      }
      if (existing) {
        // In-memory entry: the normal commit path handles manifest and item.
        await commit(token, { projectPath: safeProject });
        continue;
      }
      if (await manifestIsReadable(entryDir)) {
        // Disk entry with a usable manifest: the normal commit path handles it
        // (including a manifest whose staged item is already missing).
        await commit(token, { projectPath: safeProject });
        continue;
      }
      // Corrupt or missing manifest: recover the children directly.
      await commitOrphanEntry(token, entryDir);
    }

    // When the trash root ends up empty, remove it too (never recursive —
    // rmdir fails closed on non-empty directories).
    await fs.rmdir(trashRoot).catch(() => {});

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
