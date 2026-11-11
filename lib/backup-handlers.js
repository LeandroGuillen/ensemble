/**
 * IPC handlers for project backup snapshots (see `backup-manager`).
 *
 * Destination folders are usually chosen by the user (and already `allowPath`'d
 * by the dialog handlers) or derived from the work folder; each handler resolves
 * and guards its target before touching the filesystem. Every handler resolves
 * to the standard `ok`/`err` shape and never rejects.
 */

const { allowPath } = require('./path-guard');

function register(ipcMain, deps) {
  const { path, IPC, ok, err, assertPath, backupManager } = deps;

  /** Project-local snapshots live in the excluded backup state directory. */
  const defaultBackupDir = (projectPath) => path.join(projectPath, '.ensemble-backup', 'snapshots');

  ipcMain.handle(IPC.backupCreate, async (event, projectPath, destDir) => {
    try {
      const safeProject = assertPath(projectPath);
      const dest = destDir || defaultBackupDir(safeProject);
      allowPath(dest);
      const safeDest = assertPath(dest);
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
      const safeZip = assertPath(zipPath);
      allowPath(destParentDir);
      const safeDestParent = assertPath(destParentDir);
      const restored = await backupManager.restoreSnapshot(safeZip, safeDestParent, { restoredName });
      return ok(restored);
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.backupListSnapshots, async (event, dir, projectPath) => {
    try {
      allowPath(dir);
      const safeDir = assertPath(dir);
      const snapshots = await backupManager.listSnapshots(safeDir, assertPath(projectPath));
      return ok({ snapshots });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.backupPruneSnapshots, async (event, dir, keepN, projectPath) => {
    try {
      allowPath(dir);
      const safeDir = assertPath(dir);
      const result = await backupManager.pruneSnapshots(safeDir, keepN, assertPath(projectPath));
      return ok(result);
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register };
