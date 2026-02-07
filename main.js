const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');
const chokidar = require('chokidar');
const { autoUpdater } = require('electron-updater');
const isDev = !app.isPackaged;

let mainWindow;
let fileWatcher = null;

// Update configuration
autoUpdater.autoDownload = false; // Manual download after user approval
autoUpdater.autoInstallOnAppQuit = false; // AppImage requires manual replacement

// Suppress electron-updater's internal logging for 404 errors
// We handle these gracefully in the error handler
autoUpdater.logger = {
  info: (message) => {
    // Only log non-404 messages
    if (message && !message.includes('404') && !message.includes('releases.atom')) {
      console.log(message);
    }
  },
  warn: (message) => {
    // Only log non-404 messages
    if (message && !message.includes('404') && !message.includes('releases.atom')) {
      console.warn(message);
    }
  },
  error: (message, err) => {
    // Check if it's a 404 error
    const errorMessage = (err && err.message) || message || '';
    const is404Error = 
      (err && (err.statusCode === 404 || err.code === 404)) ||
      (message && message.includes('404')) || 
      (message && message.includes('releases.atom')) ||
      errorMessage.includes('404');
    
    // Don't log 404 errors - they're handled gracefully
    if (!is404Error) {
      console.error(message, err);
    }
  },
  debug: () => {} // Suppress debug logs
};

// Update check interval (4 hours in milliseconds)
const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;
let updateCheckInterval = null;

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
    icon: isDev 
      ? path.join(__dirname, "build/icons/icon.png")
      : path.join(process.resourcesPath, "icons", "icon.png"),
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
    // In packaged apps, __dirname should still point to the app directory
    // where main.js and dist/ are located
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
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
app.whenReady().then(() => {
  createWindow();
  
  // Initialize auto-updater (only in production)
  if (!isDev) {
    initializeUpdater();
  }
});

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
    const projects = JSON.parse(data);
    
    // Handle backward compatibility: if array of strings, convert to new format
    if (Array.isArray(projects) && projects.length > 0 && typeof projects[0] === 'string') {
      return projects
        .filter(path => typeof path === 'string' && path.trim().length > 0)
        .map(path => ({
          path,
          lastAccessed: new Date().toISOString()
        }));
    }
    
    // Filter out invalid entries where path is not a string
    if (Array.isArray(projects)) {
      return projects.filter(
        p => p && typeof p.path === 'string' && p.path.trim().length > 0
      );
    }
    
    return [];
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

// Handle recursive directory copying
ipcMain.handle('copy-directory-recursive', async (event, sourcePath, destPath) => {
  try {
    // Recursive function to copy directory and all contents
    async function copyRecursive(source, dest) {
      // Ensure destination directory exists
      await fs.mkdir(dest, { recursive: true });

      // Read all entries in source directory
      const entries = await fs.readdir(source, { withFileTypes: true });

      for (const entry of entries) {
        const sourcePath = pathModule.join(source, entry.name);
        const destPath = pathModule.join(dest, entry.name);

        if (entry.isDirectory()) {
          // Recursively copy subdirectories
          await copyRecursive(sourcePath, destPath);
        } else {
          // Copy files
          await fs.copyFile(sourcePath, destPath);
        }
      }
    }

    await copyRecursive(sourcePath, destPath);
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
  
  // Clear update check interval
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
});

// ==================== Auto-Updater Functions ====================

function initializeUpdater() {
  // Set up auto-updater event handlers
  autoUpdater.on('checking-for-update', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        status: 'checking',
        message: 'Checking for updates...'
      });
    }
  });

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        status: 'available',
        message: 'Update available',
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        status: 'not-available',
        message: 'You are using the latest version',
        version: info.version
      });
    }
  });

  autoUpdater.on('error', (err) => {
    // Handle 404 errors gracefully - they're expected when there are no releases yet
    const errorMessage = err.message || err.toString() || '';
    const errorString = JSON.stringify(err);
    
    // Check for 404 in multiple ways to catch all variations
    const is404Error = 
      err.statusCode === 404 ||
      err.code === 404 ||
      errorMessage.includes('404') || 
      errorMessage.includes('releases.atom') ||
      errorString.includes('"statusCode":404') ||
      errorString.includes('"status":404') ||
      (err.response && (err.response.statusCode === 404 || err.response.status === 404)) ||
      (err.response && err.response.status === 404);
    
    if (is404Error) {
      // Treat 404 as "no updates available" - don't show as error
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'not-available',
          message: 'You are using the latest version'
        });
      }
      // Only log at debug level, not as error
      if (isDev) {
        console.log('No releases found (404) - this is normal if no releases have been published yet');
      }
    } else {
      // For other errors, show them normally
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'error',
          message: 'Error checking for updates',
          error: errorMessage
        });
      }
      console.error('Error checking for updates:', err);
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        status: 'downloading',
        message: 'Downloading update...',
        progress: {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total
        }
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        status: 'downloaded',
        message: 'Update downloaded and ready',
        version: info.version,
        releaseNotes: info.releaseNotes,
        path: info.path
      });
    }
  });

  // Check for updates on startup
  checkForUpdates();

  // Set up periodic update checks (every 4 hours)
  updateCheckInterval = setInterval(() => {
    checkForUpdates();
  }, UPDATE_CHECK_INTERVAL);
}

function checkForUpdates() {
  if (isDev) {
    // In dev mode, only check if testing is enabled
    if (process.env.ENABLE_UPDATE_TESTING !== '1') {
      return;
    }
    // If testing is enabled, the IPC handler will handle the mock response
    // This function is called automatically on startup, so we'll skip it in test mode
    return;
  }
  
  try {
    autoUpdater.checkForUpdates().catch(err => {
      // The error handler will catch and process this, so we don't need to log it here
      // This catch is just to prevent unhandled promise rejections
    });
  } catch (error) {
    // The error handler will catch and process this, so we don't need to log it here
    // This catch is just to prevent unhandled promise rejections
  }
}

// IPC handlers for update operations
ipcMain.handle('check-for-updates', async () => {
  if (isDev) {
    // In dev mode, simulate update checking for testing
    // Set ENABLE_UPDATE_TESTING=1 environment variable to enable
    const enableTesting = process.env.ENABLE_UPDATE_TESTING === '1';
    
    if (!enableTesting) {
      return { success: false, error: 'Update checking is disabled in development mode. Set ENABLE_UPDATE_TESTING=1 to test.' };
    }
    
    // Simulate checking delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate different scenarios based on UPDATE_TEST_SCENARIO env var
    // Options: 'available', 'not-available', 'error'
    const scenario = process.env.UPDATE_TEST_SCENARIO || 'not-available';
    
    if (scenario === 'available') {
      // Simulate update available
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'available',
          message: 'Update available',
          version: '1.2.0',
          releaseDate: new Date().toISOString(),
          releaseNotes: 'Test update with new features'
        });
      }
      return { success: true };
    } else if (scenario === 'error') {
      // Simulate error
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'error',
          message: 'Error checking for updates',
          error: 'Test error: Network connection failed'
        });
      }
      return { success: false, error: 'Test error: Network connection failed' };
    } else {
      // Simulate no update available (default)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'not-available',
          message: 'You are using the latest version',
          version: app.getVersion()
        });
      }
      return { success: true };
    }
  }
  
  try {
    // The autoUpdater will emit events that are handled by the event listeners above
    // We don't need to catch errors here as they're handled by the 'error' event handler
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (error) {
    // If we get here, it's an unexpected error
    const errorMessage = error.message || error.toString() || '';
    const errorString = JSON.stringify(error);
    
    // Check if it's a 404 error
    const is404Error = 
      error.statusCode === 404 ||
      error.code === 404 ||
      errorMessage.includes('404') || 
      errorMessage.includes('releases.atom') ||
      errorString.includes('"statusCode":404') ||
      errorString.includes('"status":404');
    
    if (is404Error) {
      // Treat 404 as success (no updates available)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'not-available',
          message: 'You are using the latest version'
        });
      }
      return { success: true };
    }
    
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('download-update', async () => {
  if (isDev) {
    return { success: false, error: 'Update downloading is disabled in development mode' };
  }
  
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-update-status', async () => {
  if (isDev) {
    return { success: false, error: 'Update status is not available in development mode' };
  }
  
  try {
    const updateInfo = await autoUpdater.checkForUpdates();
    return {
      success: true,
      updateInfo: updateInfo ? {
        version: updateInfo.updateInfo?.version,
        releaseDate: updateInfo.updateInfo?.releaseDate,
        releaseNotes: updateInfo.updateInfo?.releaseNotes
      } : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('quit-and-install', async () => {
  // For AppImage, we can't auto-install, so we just quit
  // The user will need to manually replace the AppImage file
  app.quit();
  return { success: true };
});
