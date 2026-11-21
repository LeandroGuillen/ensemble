const { setWorkFolder, allowPath } = require('./path-guard');
const { resolveProjectOpenPath, DEMO_COPIES_FOLDER } = require('./demo-project');

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

  /** Show an open dialog; picked paths join the session path guard. Null (or []) when cancelled. */
  const pick = async (options) => {
    const result = await dialog.showOpenDialog(getMainWindow(), options);
    const picked = result.canceled ? [] : result.filePaths;
    picked.forEach(allowPath);
    return options.properties.includes('multiSelections') ? picked : picked[0] ?? null;
  };
  const IMAGE_FILTERS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }];

  ipcMain.handle(IPC.selectFolder, () =>
    pick({ properties: ['openDirectory'], title: 'Select Work Folder' }));

  ipcMain.handle(IPC.selectImage, () =>
    pick({ properties: ['openFile'], filters: IMAGE_FILTERS, title: 'Select Character Thumbnail' }));

  ipcMain.handle(IPC.selectImages, () =>
    pick({ properties: ['openFile', 'multiSelections'], filters: IMAGE_FILTERS, title: 'Select Character Images' }));

  ipcMain.handle(IPC.selectJson, () =>
    pick({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }], title: 'Select ComfyUI Workflow (API format)' }));

  /** Generic picker for a Markdown file or a folder (e.g. book plan paths). */
  ipcMain.handle(IPC.selectPath, (event, options = {}) => {
    const folder = options.kind === 'folder';
    return pick({
      properties: [folder ? 'openDirectory' : 'openFile'],
      filters: folder ? undefined : [{ name: 'Markdown', extensions: ['md'] }],
      title: typeof options.title === 'string' ? options.title : undefined,
      defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
    });
  });

  ipcMain.handle(IPC.getVersion, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC.getRecentProjects, async () => {
    try {
      const stored = JSON.parse(await fs.readFile(recentProjectsPath, 'utf-8'));
      if (!Array.isArray(stored)) return [];
      // Older files stored bare path strings.
      const projects = stored
        .map((p) => (typeof p === 'string' ? { path: p, lastAccessed: new Date().toISOString() } : p))
        .filter((p) => p && typeof p.path === 'string' && p.path.trim().length > 0);
      // Allow existence checks before a work folder is set (project selector).
      projects.forEach((project) => allowPath(project.path));
      return projects;
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

  /**
   * The folder to open for a picked/recent project path. The committed demo inside a git
   * checkout resolves to its writable copy under userData (see lib/demo-project.js).
   */
  ipcMain.handle(IPC.resolveProjectFolder, async (event, folderPath) => {
    try {
      if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return err('Project path must be a non-empty string');
      }
      const copiesRoot = path.join(app.getPath('userData'), DEMO_COPIES_FOLDER);
      const result = await resolveProjectOpenPath(folderPath, { fs, path, copiesRoot });
      allowPath(result.path);
      return ok(result);
    } catch (error) {
      return err(error.message);
    }
  });

  ipcMain.handle(IPC.setWorkFolder, async (event, folderPath) => {
    try {
      if (folderPath != null && typeof folderPath !== 'string') {
        return err('Work folder path must be a string');
      }

      const { trashManager, backupManager, app } = deps;

      // Commit the previous project's in-memory pending trash entries first.
      if (trashManager) {
        await trashManager.flushPending();
      }

      // Automatic snapshot before any storage migration on project open. This
      // must never block opening: a failed backup is logged and ignored.
      if (backupManager && folderPath) {
        try {
          await backupManager.maybeAutoSnapshotBeforeMigration(folderPath, {
            currentAppVersion: app.getVersion(),
          });
        } catch (backupError) {
          console.error('Automatic pre-migration backup failed:', backupError);
        }
      }

      setWorkFolder(folderPath || null);

      // Crash recovery: commit leftover `.ensemble-trash` entries on disk in the new project.
      if (trashManager && folderPath) {
        await trashManager.commitLeftoversOnDisk(folderPath);
      }

      return ok();
    } catch (error) {
      return err(error.message);
    }
  });
}

module.exports = { register };
