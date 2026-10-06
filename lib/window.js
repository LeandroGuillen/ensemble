function createWindow(deps) {
  const {
    BrowserWindow,
    path,
    app,
    IPC,
    isDev,
    getInterceptBrowserNavigation,
    setInterceptBrowserNavigation,
    setMainWindow,
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
      .then(() => win.loadURL('http://localhost:4200'))
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

  setMainWindow(win);
  return win;
}

function registerNavigationIpc(ipcMain, deps) {
  const { IPC, setInterceptBrowserNavigation } = deps;

  ipcMain.on(IPC.setBrowserNavigationInterception, (event, enabled) => {
    setInterceptBrowserNavigation(Boolean(enabled));
  });
}

module.exports = { createWindow, registerNavigationIpc };
