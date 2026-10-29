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

/**
 * True when `candidate` is the same resolved path as `root`, or inside it.
 * Separator-boundary check so sibling prefixes (mybook vs mybook-copy) are allowed.
 *
 * @param {typeof import('path')} pathModule
 * @param {string} root
 * @param {string} candidate
 */
function isSameOrInsidePath(pathModule, root, candidate) {
  const resolvedRoot = pathModule.resolve(root);
  const resolvedCandidate = pathModule.resolve(candidate);
  if (resolvedRoot === resolvedCandidate) {
    return true;
  }
  const prefix = resolvedRoot.endsWith(pathModule.sep)
    ? resolvedRoot
    : resolvedRoot + pathModule.sep;
  return resolvedCandidate.startsWith(prefix);
}

/**
 * Resolve a path for nesting checks via fs.realpath.
 * If the path (or a trailing segment) does not exist yet, realpath the nearest
 * existing ancestor and join the unresolved tail onto it — so a destination
 * under a symlink to the source is detected before any copying.
 *
 * @param {import('fs').promises} fs
 * @param {typeof import('path')} pathModule
 * @param {string} targetPath
 * @returns {Promise<string>}
 */
async function resolveRealPathForNesting(fs, pathModule, targetPath) {
  const absolute = pathModule.resolve(targetPath);
  try {
    return await fs.realpath(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const unresolved = [];
  let current = absolute;
  for (;;) {
    unresolved.unshift(pathModule.basename(current));
    const parent = pathModule.dirname(current);
    if (parent === current) {
      throw new Error(`Cannot resolve path for nesting check: ${targetPath}`);
    }
    try {
      const realParent = await fs.realpath(parent);
      return pathModule.join(realParent, ...unresolved);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      current = parent;
    }
  }
}

const TRASH_DIR_NAME = '.ensemble-trash';

function register(ipcMain, deps) {
  const { fs, path, IPC, ok, err, assertPath, shell, trashManager } = deps;

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

      // Same path is a no-op (e.g. case-only renames that do not change the filename).
      if (path.resolve(safeSource) === path.resolve(safeDest)) {
        return ok();
      }

      // Refuse to overwrite an existing destination; keep the source intact.
      try {
        await fs.access(safeDest);
        return err(`Destination already exists: ${destPath}`);
      } catch {
        // Destination does not exist — proceed.
      }

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

      // Same path is a no-op (e.g. case-only renames that do not change the filename).
      if (path.resolve(safeSource) === path.resolve(safeDest)) {
        return ok();
      }

      // Refuse to overwrite an existing destination; keep the source intact.
      try {
        await fs.access(safeDest);
        return err(`Destination already exists: ${destPath}`);
      } catch {
        // Destination does not exist — proceed.
      }

      const destDir = path.dirname(safeDest);
      await fs.mkdir(destDir, { recursive: true });
      await fs.rename(safeSource, safeDest);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  // Permanent recursive delete — only for rolling back folders the app just
  // created (e.g. character.service.ts create/draft failure cleanup). User-facing
  // deletes must go through trash-stage so they remain recoverable.
  ipcMain.handle(IPC.deleteDirectoryRecursive, async (event, dirPath) => {
    try {
      const safePath = assertPath(dirPath);
      await fs.rm(safePath, { recursive: true, force: true });
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });

  if (trashManager) {
    ipcMain.handle(IPC.trashStage, async (event, projectPath, targetPath, meta) => {
      return trashManager.stage(projectPath, targetPath, meta || {});
    });

    ipcMain.handle(IPC.trashRestore, async (event, token) => {
      return trashManager.restore(token);
    });

    ipcMain.handle(IPC.trashCommit, async (event, token) => {
      return trashManager.commit(token);
    });
  }

  ipcMain.handle(IPC.copyDirectoryRecursive, async (event, sourcePath, destPath) => {
    try {
      const safeSource = assertPath(sourcePath);
      const safeDest = assertPath(destPath);

      // Compare real paths (symlink-aware) before any copying.
      const realSource = await resolveRealPathForNesting(fs, path, safeSource);
      const realDest = await resolveRealPathForNesting(fs, path, safeDest);
      if (isSameOrInsidePath(path, realSource, realDest)) {
        return err(
          `Cannot copy a directory into itself: destination "${destPath}" is equal to or inside source "${sourcePath}"`
        );
      }

      let destExisted = false;
      try {
        const destStat = await fs.stat(safeDest);
        if (!destStat.isDirectory()) {
          return err(`Destination exists and is not a directory: ${destPath}`);
        }
        destExisted = true;
        const existingEntries = await fs.readdir(safeDest);
        if (existingEntries.length > 0) {
          return err(`Destination is not empty: ${destPath}`);
        }
      } catch (accessError) {
        if (accessError.code !== 'ENOENT') {
          throw accessError;
        }
      }

      /** @type {string[]} Paths created by this call (for partial-failure cleanup). */
      const createdPaths = [];

      async function copyRecursive(source, dest) {
        try {
          await fs.access(dest);
        } catch {
          await fs.mkdir(dest, { recursive: true });
          createdPaths.push(dest);
        }

        const entries = await fs.readdir(source, { withFileTypes: true });

        for (const entry of entries) {
          const entrySource = path.join(source, entry.name);
          const entryDest = path.join(dest, entry.name);

          if (entry.isDirectory()) {
            await copyRecursive(entrySource, entryDest);
          } else {
            await fs.copyFile(entrySource, entryDest);
            createdPaths.push(entryDest);
          }
        }
      }

      try {
        await copyRecursive(safeSource, safeDest);
        return ok();
      } catch (copyError) {
        // Clean up only what this call created; never remove pre-existing content.
        if (!destExisted) {
          await fs.rm(safeDest, { recursive: true, force: true }).catch(() => {});
        } else {
          for (const created of [...createdPaths].reverse()) {
            // Skip the pre-existing empty destination itself.
            if (path.resolve(created) === path.resolve(safeDest)) {
              continue;
            }
            await fs.rm(created, { recursive: true, force: true }).catch(() => {});
          }
        }
        return err(copyError.message);
      }
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
        if (entry.name === TRASH_DIR_NAME) {
          continue;
        }
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
          if (entry.name === TRASH_DIR_NAME) {
            continue;
          }
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

module.exports = { register, atomicWriteFile, isSameOrInsidePath, resolveRealPathForNesting };
