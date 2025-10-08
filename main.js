const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const isDev = !app.isPackaged;

let mainWindow;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    // icon: path.join(__dirname, "assets/icon.png"), // TODO: Add app icon
    show: false,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL("http://localhost:4200");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "dist/index.html"));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle folder selection dialog
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Work Folder",
  });

  return result.canceled ? null : result.filePaths[0];
});

// Handle file dialog for thumbnails
ipcMain.handle("select-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
    ],
    title: "Select Character Thumbnail",
  });

  return result.canceled ? null : result.filePaths[0];
});

// Handle version request
ipcMain.handle("get-version", () => {
  return app.getVersion();
});
