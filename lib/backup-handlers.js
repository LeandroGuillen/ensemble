/**
 * IPC handlers for project backup snapshots (see `backup-manager`).
 *
 * Backup folders live outside the project (Settings → Backup, remembered across
 * sessions), so they are resolved here without widening the session path guard
 * that every other file handler uses. Every handler resolves to the standard
 * `ok`/`err` shape and never rejects.
 */

function register(ipcMain, deps) {
  const { path, IPC, ok, err, assertPath, backupManager } = deps;

  const backupPath = (dir) => {
    if (!dir || typeof dir !== 'string') throw new Error('Backup path is required');
    return path.resolve(dir);
  };

  /** Project-local snapshots live in the excluded backup state directory. */
  const defaultBackupDir = (projectPath) => path.join(projectPath, '.ensemble-backup', 'snapshots');

  ipcMain.handle(IPC.backupCreate, async (event, projectPath, destDir) => {
    try {
      const safeProject = assertPath(projectPath);
      const safeDest = backupPath(destDir || defaultBackupDir(safeProject));
      try {
        const snapshot = await backupManager.createSnapshot(safeProject, safeDest);
        return ok({ snapshot });
      } catch (error) {
        const defaultDir = defaultBackupDir(safeProject);
        const failedPath = typeof error.path === 'string' ? path.resolve(error.path) : '';
        // Only destination failures: a denied source file must keep its own diagnosis.
        if (path.resolve(safeDest) === path.resolve(defaultDir)
          && ['EACCES', 'EPERM', 'EROFS'].includes(error.code)
          && (failedPath === path.dirname(defaultDir) || failedPath === defaultDir
            || failedPath.startsWith(defaultDir + path.sep))) {
          return {
            ...err("This project folder is read-only, so snapshots can't be saved inside it. Choose a backup folder in Settings → Backup."),
            errorCode: 'BACKUP_DESTINATION_READ_ONLY',
          };
        }
        throw error;
      }
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.backupRestore, async (event, zipPath, destParentDir, restoredName) => {
    try {
      const safeZip = backupPath(zipPath);
      const restored = await backupManager.restoreSnapshot(safeZip, backupPath(destParentDir), { restoredName });
      return ok(restored);
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.backupListSnapshots, async (event, dir, projectPath) => {
    try {
      const snapshots = await backupManager.listSnapshots(backupPath(dir), assertPath(projectPath));
      return ok({ snapshots });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.backupPruneSnapshots, async (event, dir, keepN, projectPath) => {
    try {
      const result = await backupManager.pruneSnapshots(backupPath(dir), keepN, assertPath(projectPath));
      return ok(result);
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register };
