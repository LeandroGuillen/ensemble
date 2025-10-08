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

// File system operations for project management
const fs = require('fs').promises;
const pathModule = require('path');

// Handle directory creation
ipcMain.handle("create-directory", async (event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file existence check
ipcMain.handle("file-exists", async (event, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// Handle directory check
ipcMain.handle("is-directory", async (event, dirPath) => {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
});

// Handle file reading
ipcMain.handle("read-file", async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file writing
ipcMain.handle("write-file", async (event, filePath, content) => {
  try {
    // Ensure directory exists
    const dirPath = pathModule.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
    
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle atomic file writing (write to temp file first)
ipcMain.handle("write-file-atomic", async (event, filePath, content) => {
  const tempFilePath = `${filePath}.tmp.${Date.now()}`;
  
  try {
    // Ensure directory exists
    const dirPath = pathModule.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // Write to temporary file first
    await fs.writeFile(tempFilePath, content, 'utf8');
    
    // Move temp file to target location (atomic on most filesystems)
    await fs.rename(tempFilePath, filePath);
    
    return { success: true };
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // Ignore cleanup errors
    }
    
    return { success: false, error: error.message };
  }
});

// Handle path operations
ipcMain.handle("path-join", (event, ...paths) => {
  return pathModule.join(...paths);
});

ipcMain.handle("path-basename", (event, filePath, ext) => {
  return pathModule.basename(filePath, ext);
});

ipcMain.handle("path-dirname", (event, filePath) => {
  return pathModule.dirname(filePath);
});

// Handle filename sanitization
ipcMain.handle("sanitize-filename", (event, filename) => {
  return filename
    .replace(/[<>:"|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/[^\w\-_.]/g, '') // Keep only word characters, hyphens, underscores, and dots
    .toLowerCase()
    .substring(0, 255); // Limit length
});

// Handle file deletion
ipcMain.handle("delete-file", async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle directory listing
ipcMain.handle("list-directory", async (event, dirPath) => {
  try {
    const files = await fs.readdir(dirPath);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file copying
ipcMain.handle("copy-file", async (event, sourcePath, destPath) => {
  try {
    // Ensure destination directory exists
    const destDir = pathModule.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });
    
    // Copy file
    await fs.copyFile(sourcePath, destPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file stats
ipcMain.handle("get-file-stats", async (event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return { 
      success: true, 
      stats: {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        mtime: stats.mtime,
        ctime: stats.ctime
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle converting image to data URL
ipcMain.handle("get-image-data-url", async (event, filePath) => {
  try {
    const imageBuffer = await fs.readFile(filePath);
    const ext = pathModule.extname(filePath).toLowerCase();
    
    let mimeType = 'image/jpeg'; // default
    switch (ext) {
      case '.png':
        mimeType = 'image/png';
        break;
      case '.gif':
        mimeType = 'image/gif';
        break;
      case '.webp':
        mimeType = 'image/webp';
        break;
      case '.jpg':
      case '.jpeg':
        mimeType = 'image/jpeg';
        break;
    }
    
    const base64 = imageBuffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Failed to convert image to data URL:', error);
    return null;
  }
});
