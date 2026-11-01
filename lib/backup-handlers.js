/**
 * IPC handlers for project backup snapshots (see `backup-manager`).
 *
 * Destination folders are usually chosen by the user (and already `allowPath`'d
 * by the dialog handlers) or derived from the work folder; each handler resolves
 * and guards its target before touching the filesystem. Every handler resolves
 * to the standard `ok`/`err` shape and never rejects.
 */

const { allowPath } = require('./path-guard');
const { DEFAULT_AUTO_BACKUP_FOLDER } = require('./backup-manager');

function register(ipcMain, deps) {
  const { path, IPC, ok, err, assertPath, backupManager } = deps;

  /** Default backup folder: a sibling `ensemble-backups` dir of the project. */
  const defaultBackupDir = (projectPath) => path.join(path.dirname(projectPath), DEFAULT_AUTO_BACKUP_FOLDER);

  ipcMain.handle(IPC.backupCreate, async (event, projectPath, destDir) => {
    try {
      const safeProject = assertPath(projectPath);
      const dest = destDir || defaultBackupDir(safeProject);
      allowPath(dest);
      const safeDest = assertPath(dest);
      const snapshot = await backupManager.createSnapshot(safeProject, safeDest);
      return ok({ snapshot });
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

  ipcMain.handle(IPC.backupListSnapshots, async (event, dir) => {
    try {
      allowPath(dir);
      const safeDir = assertPath(dir);
      const snapshots = await backupManager.listSnapshots(safeDir);
      return ok({ snapshots });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.backupPruneSnapshots, async (event, dir, keepN) => {
    try {
      allowPath(dir);
      const safeDir = assertPath(dir);
      const result = await backupManager.pruneSnapshots(safeDir, keepN);
      return ok(result);
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register };
