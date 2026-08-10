const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const IPC = require('./ipc-channels.json');

const { ok, err } = require('./lib/ipc-result');
const { guard } = require('./lib/path-guard');
const { normalizeRelativeFolder } = require('./lib/normalize-relative-folder');
const { createWindow, registerNavigationIpc } = require('./lib/window');
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

const windowDeps = {
  BrowserWindow,
  path,
  app,
  IPC,
  isDev,
  getInterceptBrowserNavigation,
  setInterceptBrowserNavigation,
  setMainWindow,
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

app.on('before-quit', async () => {
  await fileWatcher.closeWatcher();
  updater.clearUpdateInterval();
});
