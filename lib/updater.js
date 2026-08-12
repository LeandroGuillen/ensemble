const os = require('os');

const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const UPDATE_STATUS_CACHE_TTL = 5 * 60 * 1000;

/** @type {import('electron-updater').AppUpdater|null} */
let autoUpdater = null;
let updaterInitialized = false;
/** @type {NodeJS.Timeout|null} */
let updateCheckInterval = null;
/** @type {{ updateInfo: object|null, ts: number }|null} */
let updateStatusCache = null;

function ensureAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater;
  }

  ({ autoUpdater } = require('electron-updater'));

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.logger = {
    info: (message) => {
      console.log('[Updater]', message);
    },
    warn: (message) => {
      console.warn('[Updater]', message);
    },
    error: (message, err) => {
      const errorMessage = (err && err.message) || message || '';
      const is404Error =
        (err && (err.statusCode === 404 || err.code === 404)) ||
        (message && message.includes('404')) ||
        (message && message.includes('releases.atom')) ||
        errorMessage.includes('404');

      if (is404Error) {
        console.log('[Updater] 404 - No releases found (this is normal if no releases have been published)');
      } else {
        console.error('[Updater]', message, err);
      }
    },
    debug: (message) => {
      console.log('[Updater Debug]', message);
    },
  };

  return autoUpdater;
}

function is404Error(err) {
  const errorMessage = err?.message || err?.toString?.() || '';
  const errorString = JSON.stringify(err);

  return (
    err?.statusCode === 404 ||
    err?.code === 404 ||
    errorMessage.includes('404') ||
    errorMessage.includes('releases.atom') ||
    errorString.includes('"statusCode":404') ||
    errorString.includes('"status":404') ||
    err?.response?.statusCode === 404 ||
    err?.response?.status === 404
  );
}

/**
 * Resolve a downloaded update file path (absolute) from electron-updater info or a partial path.
 *
 * @param {string|undefined|null} updatePath
 * @param {{ fs: import('fs').promises, path: typeof import('path'), app: import('electron').App, ensureAutoUpdater?: () => import('electron-updater').AppUpdater }} deps
 * @returns {Promise<{ found: boolean, path: string|null, searched?: string[] }>}
 */
async function resolveUpdateFilePath(updatePath, deps) {
  const { fs, path, app } = deps;
  const getUpdater = deps.ensureAutoUpdater || ensureAutoUpdater;

  if (!updatePath) {
    return { found: false, path: null };
  }

  let actualPath = updatePath;

  if (path.isAbsolute(actualPath)) {
    try {
      await fs.access(actualPath);
      return { found: true, path: actualPath };
    } catch {
      return { found: false, path: actualPath };
    }
  }

  const updater = getUpdater();
  const cacheDir = updater.downloadedUpdateHelper?.cacheDir || path.join(app.getPath('userData'), 'pending');
  const possiblePath = path.join(cacheDir, actualPath);

  try {
    const stats = await fs.stat(possiblePath);
    if (stats.isFile()) {
      return { found: true, path: possiblePath };
    }
  } catch {
    // continue searching
  }

  const fileName = path.basename(actualPath);
  const homeDir = os.homedir();
  const electronUpdaterCache = path.join(homeDir, '.cache', 'electron-updater');

  const possibleLocations = [
    path.join(electronUpdaterCache, fileName),
    path.join(electronUpdaterCache, 'pending', fileName),
    path.join(app.getPath('userData'), 'pending', fileName),
    path.join(app.getPath('userData'), 'updates', fileName),
    path.join(app.getPath('userData'), 'downloaded', fileName),
    path.join(app.getPath('temp'), fileName),
    path.join(app.getPath('cache'), 'ensemble', fileName),
    path.join(app.getPath('cache'), 'electron-updater', fileName),
    path.join(app.getPath('userData'), 'cache', fileName),
    path.join(app.getPath('userData'), 'updateCache', fileName),
  ];

  for (const loc of possibleLocations) {
    try {
      const stats = await fs.stat(loc);
      if (stats.isFile()) {
        return { found: true, path: loc, searched: possibleLocations };
      }
    } catch {
      // continue
    }
  }

  const searchDirs = [
    electronUpdaterCache,
    path.join(app.getPath('userData'), 'pending'),
    path.join(app.getPath('cache'), 'electron-updater'),
    path.join(app.getPath('userData'), 'updates'),
  ];

  for (const searchDir of searchDirs) {
    try {
      const files = await fs.readdir(searchDir, { recursive: true, withFileTypes: true });
      for (const file of files) {
        if (file.isFile() && file.name === fileName) {
          const resolved = path.join(file.path || searchDir, file.name);
          return { found: true, path: resolved, searched: possibleLocations };
        }
      }
    } catch {
      // directory missing or unreadable
    }
  }

  return { found: false, path: actualPath, searched: possibleLocations };
}

function clearUpdateInterval() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
}

function initializeUpdater(deps) {
  const { app, IPC, isDev, getMainWindow } = deps;

  if (updaterInitialized) {
    console.log('[Update] Updater already initialized, skipping...');
    return;
  }

  const updater = ensureAutoUpdater();

  console.log('[Update] Initializing auto-updater...');
  console.log('[Update] App version:', app.getVersion());
  console.log('[Update] Is packaged:', app.isPackaged);
  console.log('[Update] Platform:', process.platform);
  console.log('[Update] Updater config:', {
    autoDownload: updater.autoDownload,
    autoInstallOnAppQuit: updater.autoInstallOnAppQuit,
    channel: updater.channel,
    allowPrerelease: updater.allowPrerelease,
  });

  updaterInitialized = true;

  updater.on('checking-for-update', () => {
    console.log('[Update] Event: checking-for-update');
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'checking',
        message: 'Checking for updates...',
      });
    }
  });

  updater.on('update-available', (info) => {
    console.log('[Update] Event: update-available', info.version);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'available',
        message: 'Update available',
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  updater.on('update-not-available', (info) => {
    console.log('[Update] Event: update-not-available', info.version);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'not-available',
        message: 'You are using the latest version',
        version: info.version,
      });
    }
  });

  updater.on('error', (err) => {
    const errorMessage = err.message || err.toString() || '';
    console.log('[Update] Event: error', errorMessage);

    if (is404Error(err)) {
      console.log('[Update] 404 error - treating as no updates available');
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.updateStatus, {
          status: 'not-available',
          message: 'You are using the latest version',
        });
      }
      if (isDev) {
        console.log('No releases found (404) - this is normal if no releases have been published yet');
      }
    } else {
      console.error('[Update] Error checking for updates:', err);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.updateStatus, {
          status: 'error',
          message: 'Error checking for updates',
          error: errorMessage,
        });
      }
    }
  });

  updater.on('download-progress', (progressObj) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'downloading',
        message: 'Downloading update...',
        progress: {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
        },
      });
    }
  });

  updater.on('update-downloaded', async (info) => {
    console.log('[Update] update-downloaded event:', {
      version: info.version,
      path: info.path,
      files: info.files,
      releaseDate: info.releaseDate,
      downloadedFile: info.downloadedFile,
      downloadedPath: info.downloadedPath,
    });

    const resolved = await resolveUpdateFilePath(info.path, { ...deps, ensureAutoUpdater });
    const actualPath = resolved.found ? resolved.path : info.path;

    if (!resolved.found) {
      console.log('[Update] Could not resolve downloaded update path; using raw info.path:', info.path);
    } else {
      console.log('[Update] Resolved update path to:', actualPath);
    }

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'downloaded',
        message: 'Update downloaded and ready',
        version: info.version,
        releaseNotes: info.releaseNotes,
        path: actualPath,
      });
    }
  });

  checkForUpdates(deps);

  updateCheckInterval = setInterval(() => {
    checkForUpdates(deps);
  }, UPDATE_CHECK_INTERVAL);
}

function checkForUpdates(deps) {
  const { isDev } = deps;

  if (isDev) {
    if (process.env.ENABLE_UPDATE_TESTING !== '1') {
      return;
    }
    return;
  }

  console.log('[Update] checkForUpdates() called (automatic check)');
  try {
    const updater = ensureAutoUpdater();
    updater.checkForUpdates().catch((err) => {
      console.error('[Update] Unhandled error in checkForUpdates():', err);
    });
  } catch (error) {
    console.error('[Update] Unhandled exception in checkForUpdates():', error);
  }
}

function register(ipcMain, deps) {
  const { app, IPC, isDev, getMainWindow, fs, path, shell, ok, err } = deps;

  ipcMain.handle(IPC.checkForUpdates, async () => {
    console.log('[Update] Manual update check requested');
    updateStatusCache = null;

    if (isDev) {
      const enableTesting = process.env.ENABLE_UPDATE_TESTING === '1';

      if (!enableTesting) {
        console.log('[Update] Update checking is disabled in development mode');
        return {
          success: false,
          error: 'Update checking is disabled in development mode. Set ENABLE_UPDATE_TESTING=1 to test.',
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const scenario = process.env.UPDATE_TEST_SCENARIO || 'not-available';
      const mainWindow = getMainWindow();

      if (scenario === 'available') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.updateStatus, {
            status: 'available',
            message: 'Update available',
            version: '1.2.0',
            releaseDate: new Date().toISOString(),
            releaseNotes: 'Test update with new features',
          });
        }
        return { success: true };
      }

      if (scenario === 'error') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.updateStatus, {
            status: 'error',
            message: 'Error checking for updates',
            error: 'Test error: Network connection failed',
          });
        }
        return { success: false, error: 'Test error: Network connection failed' };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.updateStatus, {
          status: 'not-available',
          message: 'You are using the latest version',
          version: app.getVersion(),
        });
      }
      return { success: true };
    }

    if (!isDev && !updaterInitialized) {
      console.log('[Update] Updater not initialized yet, initializing now...');
      initializeUpdater(deps);
    }

    try {
      console.log('[Update] Calling autoUpdater.checkForUpdates()...');
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.updateStatus, {
          status: 'checking',
          message: 'Checking for updates...',
        });
      }

      const updater = ensureAutoUpdater();
      const result = await updater.checkForUpdates();
      console.log(
        '[Update] checkForUpdates() completed:',
        result ? `result received (updateInfo: ${result.updateInfo?.version || 'N/A'})` : 'no result'
      );
      return { success: true };
    } catch (error) {
      console.error('[Update] Error in checkForUpdates():', error);
      const errorMessage = error.message || error.toString() || '';

      if (is404Error(error)) {
        console.log('[Update] 404 error - treating as no updates available');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.updateStatus, {
            status: 'not-available',
            message: 'You are using the latest version',
          });
        }
        return { success: true };
      }

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.updateStatus, {
          status: 'error',
          message: 'Error checking for updates',
          error: errorMessage,
        });
      }

      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC.downloadUpdate, async () => {
    if (isDev) {
      return { success: false, error: 'Update downloading is disabled in development mode' };
    }

    try {
      const updater = ensureAutoUpdater();
      const result = await updater.downloadUpdate();
      console.log('[Update] downloadUpdate result:', {
        updateInfo: result?.updateInfo,
        downloadPromise: result?.downloadPromise,
        cancellationToken: result?.cancellationToken,
      });
      return { success: true };
    } catch (error) {
      console.error('[Update] Error in downloadUpdate:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.getUpdateStatus, async () => {
    if (isDev) {
      return err('Update status is not available in development mode');
    }

    const now = Date.now();
    if (updateStatusCache && now - updateStatusCache.ts < UPDATE_STATUS_CACHE_TTL) {
      return ok({ updateInfo: updateStatusCache.updateInfo });
    }

    try {
      const updater = ensureAutoUpdater();
      const updateInfo = await updater.checkForUpdates();
      const result = updateInfo
        ? {
            version: updateInfo.updateInfo?.version,
            releaseDate: updateInfo.updateInfo?.releaseDate,
            releaseNotes: updateInfo.updateInfo?.releaseNotes,
          }
        : null;
      updateStatusCache = { updateInfo: result, ts: Date.now() };
      return ok({ updateInfo: result });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.quitAndInstall, async () => {
    try {
      // AppImage updates must be installed by electron-updater. Calling app.quit()
      // alone leaves the downloaded update in the cache and does not relaunch.
      ensureAutoUpdater().quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      console.error('[Update] Error installing update:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.copyUpdateToDownloads, async (event, updatePath) => {
    if (isDev) {
      return { success: false, error: 'Not available in development mode' };
    }

    try {
      if (!updatePath) {
        return { success: false, error: 'Update path not provided' };
      }

      console.log('[Update] Copy to Downloads - received path:', updatePath);

      const resolved = await resolveUpdateFilePath(updatePath, { fs, path, app, ensureAutoUpdater });
      if (!resolved.found || !resolved.path) {
        throw new Error(
          `Could not find downloaded file. Path provided: ${updatePath}. Searched: ${(resolved.searched || []).join(', ')}`
        );
      }

      const downloadsPath = app.getPath('downloads');
      const fileName = path.basename(resolved.path);
      const destPath = path.join(downloadsPath, fileName);

      await fs.mkdir(downloadsPath, { recursive: true });
      await fs.copyFile(resolved.path, destPath);
      await fs.chmod(destPath, 0o755);

      console.log('[Update] Copied update file to Downloads:', destPath);
      return { success: true, path: destPath };
    } catch (error) {
      console.error('[Update] Error copying update to Downloads:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.openUpdateFolder, async (event, updatePath) => {
    if (isDev) {
      return { success: false, error: 'Not available in development mode' };
    }

    try {
      if (!updatePath) {
        return { success: false, error: 'Update path not provided' };
      }

      console.log('[Update] Open folder - received path:', updatePath);

      let folderPath;

      if (path.isAbsolute(updatePath)) {
        folderPath = path.dirname(updatePath);
      } else {
        const resolved = await resolveUpdateFilePath(updatePath, { fs, path, app, ensureAutoUpdater });
        if (resolved.found && resolved.path) {
          folderPath = path.dirname(resolved.path);
          console.log('[Update] Found file at:', resolved.path);
        } else {
          folderPath = path.join(app.getPath('userData'), 'pending');
          console.log('[Update] File not found, opening likely cache directory:', folderPath);
        }
      }

      try {
        await fs.access(folderPath);
      } catch {
        try {
          await fs.mkdir(folderPath, { recursive: true });
        } catch {
          folderPath = app.getPath('downloads');
          console.log('[Update] Using Downloads folder as fallback:', folderPath);
        }
      }

      await shell.openPath(folderPath);

      console.log('[Update] Opened folder:', folderPath);
      return { success: true };
    } catch (error) {
      console.error('[Update] Error opening update folder:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  initializeUpdater,
  checkForUpdates,
  register,
  clearUpdateInterval,
  resolveUpdateFilePath,
  ensureAutoUpdater,
};
