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
      console.error('[Updater]', message, err);
    },
    debug: (message) => {
      console.log('[Updater Debug]', message);
    },
  };

  return autoUpdater;
}

function clearUpdateInterval() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
}

function initializeUpdater(deps) {
  const { app, IPC, getMainWindow } = deps;

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
        currentVersion: app.getVersion(),
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
        currentVersion: app.getVersion(),
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
        currentVersion: app.getVersion(),
        version: info.version,
      });
    }
  });

  updater.on('error', (err) => {
    const errorMessage = err.message || err.toString() || '';
    console.log('[Update] Event: error', errorMessage);

    console.error('[Update] Error checking for updates:', err);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'error',
        message: 'Error checking for updates',
        currentVersion: app.getVersion(),
        error: errorMessage,
      });
    }
  });

  updater.on('download-progress', (progressObj) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'downloading',
        message: 'Downloading update...',
        currentVersion: app.getVersion(),
        progress: {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
        },
      });
    }
  });

  updater.on('update-downloaded', (info) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.updateStatus, {
        status: 'downloaded',
        message: 'Update downloaded and ready to install',
        currentVersion: app.getVersion(),
        version: info.version,
        releaseNotes: info.releaseNotes,
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
  const { app, IPC, isDev, getMainWindow, ok, err } = deps;

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
            currentVersion: app.getVersion(),
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
            currentVersion: app.getVersion(),
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
          currentVersion: app.getVersion(),
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

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.updateStatus, {
          status: 'error',
          message: 'Error checking for updates',
          currentVersion: app.getVersion(),
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
      // Let electron-updater install the package selected for this platform.
      ensureAutoUpdater().quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      console.error('[Update] Error installing update:', error);
      return { success: false, error: error.message };
    }
  });

}

module.exports = {
  initializeUpdater,
  checkForUpdates,
  register,
  clearUpdateInterval,
  ensureAutoUpdater,
};
