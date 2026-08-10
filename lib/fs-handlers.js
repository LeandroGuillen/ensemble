const picomatch = require('picomatch');

/**
 * Write content atomically via temp file + rename. Never falls back to direct
 * write of the target path.
 *
 * @param {import('fs').promises} fs
 * @param {typeof import('path')} pathModule
 * @param {string} filePath
 * @param {string|Buffer} content
 * @param {{ encoding?: BufferEncoding }} [options]
 */
async function atomicWriteFile(fs, pathModule, filePath, content, options = {}) {
  const isBuffer = Buffer.isBuffer(content);
  const writeOptions = isBuffer ? undefined : options.encoding || 'utf8';
  const dirPath = pathModule.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  const tempPaths = [];

  const cleanupTemps = async () => {
    for (const tempPath of tempPaths) {
      await fs.unlink(tempPath).catch(() => {});
    }
  };

  const writeTemp = async () => {
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    tempPaths.push(tempPath);
    await fs.writeFile(tempPath, content, writeOptions);
    return tempPath;
  };

  const renameToTarget = async (tempPath) => {
    await fs.rename(tempPath, filePath);
    tempPaths.splice(tempPaths.indexOf(tempPath), 1);
  };

  const firstTemp = await writeTemp();

  try {
    await renameToTarget(firstTemp);
    return;
  } catch {
    // First rename failed — try once more if temp still exists, else fresh retry temp.
    try {
      await renameToTarget(firstTemp);
      return;
    } catch {
      await fs.unlink(firstTemp).catch(() => {});
      tempPaths.splice(tempPaths.indexOf(firstTemp), 1);
    }
  }

  const retryTemp = await writeTemp();
  try {
    await renameToTarget(retryTemp);
  } catch (renameErr) {
    await cleanupTemps();
    throw renameErr;
  }
}

function register(ipcMain, deps) {
  const { fs, path, IPC, ok, err, assertPath, shell } = deps;

  ipcMain.handle(IPC.createDirectory, async (event, dirPath) => {
    try {
      const safePath = assertPath(dirPath);
      await fs.mkdir(safePath, { recursive: true });
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.fileExists, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      await fs.access(safePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.isDirectory, async (event, dirPath) => {
    try {
      const safePath = assertPath(dirPath);
      const stats = await fs.stat(safePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.readFile, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      const content = await fs.readFile(safePath, 'utf8');
      return ok({ content });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.writeFile, async (event, filePath, content) => {
    try {
      const safePath = assertPath(filePath);
      const dirPath = path.dirname(safePath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(safePath, content, 'utf8');
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.writeFileAtomic, async (event, filePath, content) => {
    try {
      const safePath = assertPath(filePath);
      await atomicWriteFile(fs, path, safePath, content, { encoding: 'utf8' });
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.deleteFile, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      await fs.unlink(safePath);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.listDirectory, async (event, dirPath) => {
    try {
      const safePath = assertPath(dirPath);
      const files = await fs.readdir(safePath);
      return ok({ files });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.copyFile, async (event, sourcePath, destPath) => {
    try {
      const safeSource = assertPath(sourcePath);
      const safeDest = assertPath(destPath);
      const destDir = path.dirname(safeDest);
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(safeSource, safeDest);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.moveFile, async (event, sourcePath, destPath) => {
    try {
      const safeSource = assertPath(sourcePath);
      const safeDest = assertPath(destPath);
      const destDir = path.dirname(safeDest);
      await fs.mkdir(destDir, { recursive: true });
      await fs.rename(safeSource, safeDest);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.getFileStats, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      const stats = await fs.stat(safePath);
      const statsResult = {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        mtime: stats.mtime,
        ctime: stats.ctime,
      };
      return ok({ stats: statsResult });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.getImageDataUrl, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      const imageBuffer = await fs.readFile(safePath);
      const ext = path.extname(safePath).toLowerCase();

      let mimeType = 'image/jpeg';
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

  ipcMain.handle(IPC.moveDirectory, async (event, sourcePath, destPath) => {
    try {
      const safeSource = assertPath(sourcePath);
      const safeDest = assertPath(destPath);
      const destDir = path.dirname(safeDest);
      await fs.mkdir(destDir, { recursive: true });
      await fs.rename(safeSource, safeDest);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.deleteDirectoryRecursive, async (event, dirPath) => {
    try {
      const safePath = assertPath(dirPath);
      await fs.rm(safePath, { recursive: true, force: true });
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.copyDirectoryRecursive, async (event, sourcePath, destPath) => {
    try {
      const safeSource = assertPath(sourcePath);
      const safeDest = assertPath(destPath);

      async function copyRecursive(source, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(source, { withFileTypes: true });

        for (const entry of entries) {
          const entrySource = path.join(source, entry.name);
          const entryDest = path.join(dest, entry.name);

          if (entry.isDirectory()) {
            await copyRecursive(entrySource, entryDest);
          } else {
            await fs.copyFile(entrySource, entryDest);
          }
        }
      }

      await copyRecursive(safeSource, safeDest);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.readDirectoryFiles, async (event, dirPath) => {
    try {
      const safePath = assertPath(dirPath);
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const files = [];
      const directories = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(entry.name);
        } else if (entry.isDirectory()) {
          directories.push(entry.name);
        }
      }

      return ok({ files, directories });
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.readDirectoryRecursive, async (event, dirPath, pattern) => {
    try {
      const safePath = assertPath(dirPath);
      const results = [];
      const isMatch = picomatch(pattern, { dot: true });

      async function scan(currentDir, baseDir) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await scan(fullPath, baseDir);
          } else if (entry.isFile() && isMatch(entry.name)) {
            const relativePath = path.relative(baseDir, fullPath);
            results.push({ relativePath, absolutePath: fullPath });
          }
        }
      }

      await scan(safePath, safePath);
      return ok({ files: results });
    } catch (error) {
      return { success: false, error: error.message, files: [] };
    }
  });

  ipcMain.handle(IPC.openFileInEditor, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      await shell.openPath(safePath);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.showItemInFolder, async (event, filePath) => {
    try {
      const safePath = assertPath(filePath);
      shell.showItemInFolder(safePath);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.openPath, async (event, folderPath) => {
    try {
      const safePath = assertPath(folderPath);
      await fs.mkdir(safePath, { recursive: true });
      const errorMessage = await shell.openPath(safePath);
      if (errorMessage) {
        return err(errorMessage);
      }
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register, atomicWriteFile };
