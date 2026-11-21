const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;

/** @type {import('electron-updater').AppUpdater|null} */
let autoUpdater = null;
/** @type {NodeJS.Timeout|null} */
let updateCheckInterval = null;
let initialized = false;

function ensureAutoUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
      info: (message) => console.log('[Updater]', message),
      warn: (message) => console.warn('[Updater]', message),
      error: (message, error) => console.error('[Updater]', message, error),
      debug: () => {},
    };
  }
  return autoUpdater;
}

/** Push an `update-status` event to the window, always tagged with the running version. */
function statusSender({ app, IPC, getMainWindow }) {
  return (status) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.updateStatus, { currentVersion: app.getVersion(), ...status });
    }
  };
}

function clearUpdateInterval() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
}

function checkInBackground() {
  ensureAutoUpdater().checkForUpdates().catch((error) => {
    console.error('[Update] Automatic update check failed:', error);
  });
}

/** Wire updater events to the window and check now and every few hours (packaged builds only). */
function initializeUpdater(deps) {
  if (initialized) return;
  initialized = true;
  const send = statusSender(deps);
  const updater = ensureAutoUpdater();

  updater.on('checking-for-update', () => send({ status: 'checking', message: 'Checking for updates...' }));
  updater.on('update-available', (info) => send({
    status: 'available',
    message: 'Update available',
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
  }));
  updater.on('update-not-available', (info) => send({
    status: 'not-available',
    message: 'You are using the latest version',
    version: info.version,
  }));
  updater.on('error', (error) => {
    console.error('[Update] Error checking for updates:', error);
    send({ status: 'error', message: 'Error checking for updates', error: error.message || String(error) });
  });
  updater.on('download-progress', ({ percent, transferred, total }) => send({
    status: 'downloading',
    message: 'Downloading update...',
    progress: { percent, transferred, total },
  }));
  updater.on('update-downloaded', (info) => send({
    status: 'downloaded',
    message: 'Update downloaded and ready to install',
    version: info.version,
    releaseNotes: info.releaseNotes,
  }));

  checkInBackground();
  updateCheckInterval = setInterval(checkInBackground, UPDATE_CHECK_INTERVAL);
}

/**
 * Dev builds never reach the update server. `ENABLE_UPDATE_TESTING=1` with
 * `UPDATE_TEST_SCENARIO` (available | error | not-available) fakes a check so
 * the update UI can be exercised (`npm run electron-dev:test-updates*`).
 */
async function fakeDevCheck(send, app) {
  if (process.env.ENABLE_UPDATE_TESTING !== '1') {
    return { success: false, error: 'Update checking is disabled in development mode. Set ENABLE_UPDATE_TESTING=1 to test.' };
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const scenario = process.env.UPDATE_TEST_SCENARIO;
  if (scenario === 'available') {
    send({ status: 'available', message: 'Update available', version: '1.2.0', releaseDate: new Date().toISOString(), releaseNotes: 'Test update with new features' });
    return { success: true };
  }
  if (scenario === 'error') {
    const error = 'Test error: Network connection failed';
    send({ status: 'error', message: 'Error checking for updates', error });
    return { success: false, error };
  }
  send({ status: 'not-available', message: 'You are using the latest version', version: app.getVersion() });
  return { success: true };
}

function register(ipcMain, deps) {
  const { app, IPC, isDev, ok, err } = deps;
  const send = statusSender(deps);

  ipcMain.handle(IPC.checkForUpdates, async () => {
    if (isDev) return fakeDevCheck(send, app);
    initializeUpdater(deps);
    try {
      send({ status: 'checking', message: 'Checking for updates...' });
      await ensureAutoUpdater().checkForUpdates();
      return ok();
    } catch (error) {
      const message = error.message || String(error);
      send({ status: 'error', message: 'Error checking for updates', error: message });
      return err(message);
    }
  });

  ipcMain.handle(IPC.downloadUpdate, async () => {
    if (isDev) return err('Update downloading is disabled in development mode');
    try {
      await ensureAutoUpdater().downloadUpdate();
      return ok();
    } catch (error) {
      console.error('[Update] Error in downloadUpdate:', error);
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.quitAndInstall, async () => {
    try {
      // Let electron-updater install the package selected for this platform.
      ensureAutoUpdater().quitAndInstall(false, true);
      return ok();
    } catch (error) {
      console.error('[Update] Error installing update:', error);
      return err(error.message);
    }
  });
}

module.exports = { initializeUpdater, register, clearUpdateInterval };
