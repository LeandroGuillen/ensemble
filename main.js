const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const IPC = require('./ipc-channels.json');

const { ok, err } = require('./lib/ipc-result');
const { guard } = require('./lib/path-guard');
const { normalizeRelativeFolder } = require('./lib/normalize-relative-folder');
const { createWindow, registerNavigationIpc } = require('./lib/window');
const { createLifecycleController } = require('./lib/window-lifecycle');
const { createTrashManager, createQuitFlushGuard } = require('./lib/trash-manager');
const dialogHandlers = require('./lib/dialog-handlers');
const fsHandlers = require('./lib/fs-handlers');
const fileWatcher = require('./lib/file-watcher');
const aiHttp = require('./lib/ai-http');
const updater = require('./lib/updater');

const isDev = !app.isPackaged;

/** @type {import('electron').BrowserWindow|null} */
let mainWindow = null;
let interceptBrowserNavigation = false;

const recentProjectsPath = path.join(app.getPath('userData'), 'recent-projects.json');

function getMainWindow() {
  return mainWindow;
}

function setMainWindow(win) {
  mainWindow = win;
}

function getInterceptBrowserNavigation() {
  return interceptBrowserNavigation;
}

function setInterceptBrowserNavigation(enabled) {
  interceptBrowserNavigation = enabled;
}

const assertPath = (filePath) => guard(filePath, app);

const lifecycle = createLifecycleController({
  app,
  ipcMain,
  IPC,
  getMainWindow,
  Menu,
});

const trashManager = createTrashManager({
  fs,
  path,
  shell,
  timers: { setTimeout, clearTimeout },
  assertPath,
  emitCommitFailed: (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.trashCommitFailed, payload);
    }
  },
});

const trashQuitFlush = createQuitFlushGuard({
  flush: () => trashManager.flushPending(),
  quit: () => app.quit(),
});

const windowDeps = {
  BrowserWindow,
  path,
  app,
  IPC,
  isDev,
  getInterceptBrowserNavigation,
  setInterceptBrowserNavigation,
  setMainWindow,
  lifecycle,
};

const sharedDeps = {
  app,
  fs,
  path,
  IPC,
  ok,
  err,
  isDev,
  getMainWindow,
  assertPath,
  shell,
  normalizeRelativeFolder,
  chokidar,
  recentProjectsPath,
  dialog,
  trashManager,
};

registerNavigationIpc(ipcMain, {
  IPC,
  setInterceptBrowserNavigation,
});

dialogHandlers.register(ipcMain, sharedDeps);
fsHandlers.register(ipcMain, sharedDeps);
fileWatcher.register(ipcMain, sharedDeps);
aiHttp.register(ipcMain, sharedDeps);
updater.register(ipcMain, sharedDeps);

app.whenReady().then(() => {
  createWindow(windowDeps);

  if (!isDev) {
    updater.initializeUpdater(sharedDeps);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(windowDeps);
  }
});

app.on('before-quit', async (event) => {
  // Defer quit until the renderer has flushed / resolved book-plan leave.
  // Cleanup must not run when the user cancels a conflict prompt.
  if (!lifecycle.handleBeforeQuit(event)) {
    return;
  }

  // Commit all pending trash entries before exit (failed ones stay staged).
  // Guard prevents a quit loop when we re-issue app.quit() after flush.
  const shouldContinue = await trashQuitFlush.run(event);
  if (!shouldContinue) {
    return;
  }

  await fileWatcher.closeWatcher();
  updater.clearUpdateInterval();
});
