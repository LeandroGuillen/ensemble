/** @type {import('chokidar').FSWatcher|null} */
let fileWatcher = null;

function getFileWatcher() {
  return fileWatcher;
}

function setFileWatcher(watcher) {
  fileWatcher = watcher;
}

async function closeWatcher() {
  if (fileWatcher) {
    await fileWatcher.close();
    fileWatcher = null;
  }
}

function register(ipcMain, deps) {
  const {
    chokidar,
    path,
    IPC,
    ok,
    err,
    getMainWindow,
    normalizeRelativeFolder,
    assertPath,
  } = deps;

  ipcMain.handle(IPC.startFileWatcher, async (event, projectPath, watchFolders = ['characters']) => {
    try {
      const safeProjectPath = assertPath(projectPath);

      if (fileWatcher) {
        await fileWatcher.close();
        fileWatcher = null;
      }

      const folders = Array.isArray(watchFolders)
        ? watchFolders
        : [typeof watchFolders === 'string' ? watchFolders : 'characters'];
      const absolutePaths = folders
        .map((folder) => normalizeRelativeFolder(String(folder || ''), 'characters'))
        .filter(Boolean)
        .map((relative) => {
          const absolute = path.join(safeProjectPath, relative);
          assertPath(absolute);
          return absolute;
        });

      if (absolutePaths.length === 0) {
        absolutePaths.push(path.join(safeProjectPath, 'characters'));
      }

      fileWatcher = chokidar.watch(absolutePaths, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });

      fileWatcher
        .on('add', (filePath) => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.fileChanged, {
              type: 'add',
              path: filePath,
              filename: path.basename(filePath),
            });
          }
        })
        .on('change', (filePath) => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.fileChanged, {
              type: 'change',
              path: filePath,
              filename: path.basename(filePath),
            });
          }
        })
        .on('unlink', (filePath) => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC.fileChanged, {
              type: 'unlink',
              path: filePath,
              filename: path.basename(filePath),
            });
          }
        });

      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.stopFileWatcher, async () => {
    try {
      await closeWatcher();
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = {
  register,
  closeWatcher,
  getFileWatcher,
  setFileWatcher,
};
