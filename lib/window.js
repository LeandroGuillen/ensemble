const { devServerUrl } = require('./dev-server');

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Hand web and mail links to the system; everything else (file:, javascript:, …) is dropped. */
function openExternally(shell, url) {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    // Not a URL: nothing to open.
  }
}

/**
 * The window runs with Node integration, so it must never show anything but the app:
 * other documents (clicked links, dropped files) are blocked and `window.open` /
 * `target="_blank"` links open in the system browser instead of an Electron window.
 */
function lockToApp(webContents, shell) {
  const documentOf = (url) => url.split('#')[0];
  webContents.on('will-navigate', (event, url) => {
    if (documentOf(url) === documentOf(webContents.getURL())) return;
    event.preventDefault();
    openExternally(shell, url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    openExternally(shell, url);
    return { action: 'deny' };
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function createWindow(deps) {
  const {
    BrowserWindow,
    path,
    app,
    shell,
    IPC,
    isDev,
    getInterceptBrowserNavigation,
    setInterceptBrowserNavigation,
    setMainWindow,
    lifecycle,
  } = deps;

  const version = app.getVersion();
  const title = `Ensemble v${version}`;

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: isDev
      ? path.join(__dirname, '..', 'build', 'icons', 'icon.png')
      : path.join(process.resourcesPath, 'icons', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
  });
  lockToApp(win.webContents, shell);

  win.on('app-command', (event, command) => {
    if (
      getInterceptBrowserNavigation() &&
      (command === 'browser-backward' || command === 'browser-forward')
    ) {
      event.preventDefault();
      win.webContents.send(
        IPC.browserNavigationCommand,
        command === 'browser-backward' ? 'back' : 'forward'
      );
    }
  });

  if (isDev) {
    // Vite replaces optimized dependency chunks as imports change. Electron's
    // persistent HTTP cache can otherwise request old chunks and leave a blank
    // window with 504 "Outdated Optimize Dep" errors after restarting.
    win.webContents.session.clearCache()
      .then(() => win.loadURL(devServerUrl(process.env)))
      .catch(error => console.error('Failed to load development window:', error));
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'browser', 'index.html');
    win.loadFile(indexPath);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    setMainWindow(null);
    setInterceptBrowserNavigation(false);
  });

  if (lifecycle) {
    lifecycle.attachWindow(win);
  }

  setMainWindow(win);
  return win;
}

function registerNavigationIpc(ipcMain, deps) {
  const { IPC, setInterceptBrowserNavigation } = deps;

  ipcMain.on(IPC.setBrowserNavigationInterception, (event, enabled) => {
    setInterceptBrowserNavigation(Boolean(enabled));
  });
}

module.exports = { createWindow, registerNavigationIpc, lockToApp };
