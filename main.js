const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const chokidar = require('chokidar');
const isDev = !app.isPackaged;

let mainWindow;
let fileWatcher = null;

function createWindow() {
  // Get app version for title
  const version = app.getVersion();
  const title = `Ensemble v${version}`;

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: title,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    // icon: path.join(__dirname, "assets/icon.png"), // TODO: Add app icon
    show: false,
    autoHideMenuBar: true,
  });

  // Remove menu completely to prevent Alt key from showing it
  // mainWindow.setMenu(null);

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:4200');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle folder selection dialog
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Work Folder',
  });

  return result.canceled ? null : result.filePaths[0];
});

// Handle file dialog for thumbnails (single image)
ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    title: 'Select Character Thumbnail',
  });

  return result.canceled ? null : result.filePaths[0];
});

// Handle file dialog for multiple images
ipcMain.handle('select-images', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    title: 'Select Character Images',
  });

  return result.canceled ? [] : result.filePaths;
});

// Handle version request
ipcMain.handle('get-version', () => {
  return app.getVersion();
});

// Handle recent projects storage (persistent across app restarts)
const recentProjectsPath = path.join(app.getPath('userData'), 'recent-projects.json');

ipcMain.handle('get-recent-projects', async () => {
  try {
    const data = await fs.readFile(recentProjectsPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist or is invalid, return empty array
    return [];
  }
});

ipcMain.handle('save-recent-projects', async (event, projects) => {
  try {
    await fs.writeFile(recentProjectsPath, JSON.stringify(projects, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to save recent projects:', error);
    return { success: false, error: error.message };
  }
});

// File system operations for project management
const pathModule = require('path');

// Handle directory creation
ipcMain.handle('create-directory', async (event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file existence check
ipcMain.handle('file-exists', async (event, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// Handle directory check
ipcMain.handle('is-directory', async (event, dirPath) => {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
});

// Handle file reading
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file writing
ipcMain.handle('write-file', async (event, filePath, content) => {
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
ipcMain.handle('write-file-atomic', async (event, filePath, content) => {
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
ipcMain.handle('path-join', (event, ...paths) => {
  return pathModule.join(...paths);
});

ipcMain.handle('path-basename', (event, filePath, ext) => {
  return pathModule.basename(filePath, ext);
});

ipcMain.handle('path-dirname', (event, filePath) => {
  return pathModule.dirname(filePath);
});

// Handle filename sanitization
ipcMain.handle('sanitize-filename', (event, filename) => {
  return filename
    .replace(/[<>:"|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/[^\w\-_.]/g, '') // Keep only word characters, hyphens, underscores, and dots
    .toLowerCase()
    .substring(0, 255); // Limit length
});

// Handle file deletion
ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle directory listing
ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    const files = await fs.readdir(dirPath);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle file copying
ipcMain.handle('copy-file', async (event, sourcePath, destPath) => {
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
ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return {
      success: true,
      stats: {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        mtime: stats.mtime,
        ctime: stats.ctime,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle converting image to data URL
ipcMain.handle('get-image-data-url', async (event, filePath) => {
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

// Handle moving/renaming directories
ipcMain.handle('move-directory', async (event, sourcePath, destPath) => {
  try {
    // Ensure destination parent directory exists
    const destDir = pathModule.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // Move the directory
    await fs.rename(sourcePath, destPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle recursive directory deletion
ipcMain.handle('delete-directory-recursive', async (event, dirPath) => {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle reading all files in a directory (non-recursive)
ipcMain.handle('read-directory-files', async (event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];
    const directories = [];

    for (const entry of entries) {
      if (entry.isFile()) {
        files.push(entry.name);
      } else if (entry.isDirectory()) {
        directories.push(entry.name);
      }
    }

    return { success: true, files, directories };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// File watching
ipcMain.handle('start-file-watcher', async (event, projectPath) => {
  try {
    // Stop existing watcher if any
    if (fileWatcher) {
      await fileWatcher.close();
      fileWatcher = null;
    }

    // Watch the characters directory recursively
    const charactersPath = pathModule.join(projectPath, 'characters');

    fileWatcher = chokidar.watch(charactersPath, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    fileWatcher
      .on('add', (filePath) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-changed', {
            type: 'add',
            path: filePath,
            filename: pathModule.basename(filePath),
          });
        }
      })
      .on('change', (filePath) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-changed', {
            type: 'change',
            path: filePath,
            filename: pathModule.basename(filePath),
          });
        }
      })
      .on('unlink', (filePath) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('file-changed', {
            type: 'unlink',
            path: filePath,
            filename: pathModule.basename(filePath),
          });
        }
      });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-file-watcher', async (event) => {
  try {
    if (fileWatcher) {
      await fileWatcher.close();
      fileWatcher = null;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle AI HTTP requests
ipcMain.handle('ai-request', async (event, url, options) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    // Force IPv4 for localhost to avoid IPv6 connection issues
    let hostname = urlObj.hostname;
    if (hostname === 'localhost') {
      hostname = '127.0.0.1';
    }

    const requestOptions = {
      hostname: hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000,
    };

    const req = protocol.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            data: data,
          };

          // Try to parse JSON if content-type is application/json
          if (res.headers['content-type']?.includes('application/json')) {
            try {
              response.data = JSON.parse(data);
            } catch (e) {
              // Keep as string if JSON parse fails
            }
          }

          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    // Write request body if provided
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }

    req.end();
  });
});

// Handle opening file in system default editor
ipcMain.handle('open-file-in-editor', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Cleanup watcher on app quit
app.on('before-quit', async () => {
  if (fileWatcher) {
    await fileWatcher.close();
    fileWatcher = null;
  }
});
