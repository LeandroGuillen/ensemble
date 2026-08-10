const { setWorkFolder, allowPath } = require('./path-guard');

function register(ipcMain, deps) {
  const {
    dialog,
    getMainWindow,
    app,
    fs,
    path,
    IPC,
    ok,
    err,
    recentProjectsPath,
  } = deps;

  ipcMain.handle(IPC.selectFolder, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory'],
      title: 'Select Work Folder',
    });

    if (result.canceled) {
      return null;
    }
    const selected = result.filePaths[0];
    // Allow subsequent FS ops on the user-picked folder (open/create/duplicate).
    allowPath(selected);
    return selected;
  });

  ipcMain.handle(IPC.selectImage, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      title: 'Select Character Thumbnail',
    });

    if (result.canceled) {
      return null;
    }
    const selected = result.filePaths[0];
    allowPath(selected);
    return selected;
  });

  ipcMain.handle(IPC.selectImages, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      title: 'Select Character Images',
    });

    if (result.canceled) {
      return [];
    }
    for (const selected of result.filePaths) {
      allowPath(selected);
    }
    return result.filePaths;
  });

  ipcMain.handle(IPC.selectJson, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
      title: 'Select ComfyUI Workflow (API format)',
    });

    if (result.canceled) {
      return null;
    }
    const selected = result.filePaths[0];
    allowPath(selected);
    return selected;
  });

  ipcMain.handle(IPC.getVersion, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC.getRecentProjects, async () => {
    try {
      const data = await fs.readFile(recentProjectsPath, 'utf-8');
      const projects = JSON.parse(data);

      if (Array.isArray(projects) && projects.length > 0 && typeof projects[0] === 'string') {
        const normalized = projects
          .filter((p) => typeof p === 'string' && p.trim().length > 0)
          .map((p) => ({
            path: p,
            lastAccessed: new Date().toISOString(),
          }));
        // Allow existence checks before a work folder is set (project selector).
        for (const project of normalized) {
          allowPath(project.path);
        }
        return normalized;
      }

      if (Array.isArray(projects)) {
        const normalized = projects.filter(
          (p) => p && typeof p.path === 'string' && p.path.trim().length > 0
        );
        for (const project of normalized) {
          allowPath(project.path);
        }
        return normalized;
      }

      return [];
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.saveRecentProjects, async (event, projects) => {
    try {
      await fs.writeFile(recentProjectsPath, JSON.stringify(projects, null, 2), 'utf-8');
      return ok();
    } catch (error) {
      console.error('Failed to save recent projects:', error);
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.setWorkFolder, async (event, folderPath) => {
    try {
      if (folderPath != null && typeof folderPath !== 'string') {
        return err('Work folder path must be a string');
      }
      setWorkFolder(folderPath || null);
      return ok();
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register };
