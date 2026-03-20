import { Injectable } from '@angular/core';
import { LoggingService } from './logging.service';

declare global {
  interface Window {
    require: any;
  }
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  public ipcRenderer: any;

  constructor(private logger: LoggingService) {
    if (this.isElectron()) {
      this.ipcRenderer = window.require('electron').ipcRenderer;
    }
  }

  isElectron(): boolean {
    return !!(window && window.require);
  }

  // File system operations
  async createDirectory(dirPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('create-directory', dirPath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    if (!this.isElectron()) {
      return false;
    }
    return await this.ipcRenderer.invoke('file-exists', filePath);
  }

  async isDirectory(dirPath: string): Promise<boolean> {
    if (!this.isElectron()) {
      return false;
    }
    return await this.ipcRenderer.invoke('is-directory', dirPath);
  }

  async readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('read-file', filePath);
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('write-file', filePath, content);
  }

  async writeFileAtomic(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('write-file-atomic', filePath, content);
  }

  // Path operations
  async pathJoin(...paths: string[]): Promise<string> {
    if (!this.isElectron()) {
      return paths.join('/'); // Fallback for non-Electron environments
    }
    return await this.ipcRenderer.invoke('path-join', ...paths);
  }

  async pathBasename(filePath: string, ext?: string): Promise<string> {
    if (!this.isElectron()) {
      const parts = filePath.split('/');
      let basename = parts[parts.length - 1];
      if (ext && basename.endsWith(ext)) {
        basename = basename.slice(0, -ext.length);
      }
      return basename;
    }
    return await this.ipcRenderer.invoke('path-basename', filePath, ext);
  }

  async pathDirname(filePath: string): Promise<string> {
    if (!this.isElectron()) {
      const parts = filePath.split('/');
      return parts.slice(0, -1).join('/');
    }
    return await this.ipcRenderer.invoke('path-dirname', filePath);
  }

  async sanitizeFilename(filename: string): Promise<string> {
    if (!this.isElectron()) {
      return filename
        .replace(/[<>:"|?*]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^\w\-_.]/g, '')
        .toLowerCase()
        .substring(0, 255);
    }
    return await this.ipcRenderer.invoke('sanitize-filename', filename);
  }

  // Dialog operations
  async selectFolder(): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }
    return await this.ipcRenderer.invoke('select-folder');
  }

  async selectImage(): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }
    return await this.ipcRenderer.invoke('select-image');
  }

  async selectImages(): Promise<string[]> {
    if (!this.isElectron()) {
      return [];
    }
    return await this.ipcRenderer.invoke('select-images');
  }

  async getVersion(): Promise<string> {
    if (!this.isElectron()) {
      return '1.0.0';
    }
    return await this.ipcRenderer.invoke('get-version');
  }

  // Additional file operations needed for character management
  async deleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('delete-file', filePath);
  }

  async listDirectory(dirPath: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('list-directory', dirPath);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('copy-file', sourcePath, destPath);
  }

  async moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('move-file', sourcePath, destPath);
  }

  async getFileStats(filePath: string): Promise<{ success: boolean; stats?: any; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('get-file-stats', filePath);
  }

  async getImageAsDataUrl(filePath: string): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }

    try {
      return await this.ipcRenderer.invoke('get-image-data-url', filePath);
    } catch (error) {
      this.logger.error('Failed to get image as data URL', error);
      return null;
    }
  }

  async moveDirectory(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('move-directory', sourcePath, destPath);
  }

  async deleteDirectoryRecursive(dirPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('delete-directory-recursive', dirPath);
  }

  async copyDirectoryRecursive(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('copy-directory-recursive', sourcePath, destPath);
  }

  async readDirectoryFiles(dirPath: string): Promise<{ success: boolean; files?: string[]; directories?: string[]; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('read-directory-files', dirPath);
  }

  async readDirectoryRecursive(
    dirPath: string,
    pattern: string
  ): Promise<{ success: boolean; files?: Array<{ relativePath: string; absolutePath: string }>; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron', files: [] };
    }
    return await this.ipcRenderer.invoke('read-directory-recursive', dirPath, pattern);
  }

  // File watching
  async startFileWatcher(projectPath: string, charactersFolder = 'characters'): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('start-file-watcher', projectPath, charactersFolder);
  }

  async stopFileWatcher(): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('stop-file-watcher');
  }

  onFileChanged(callback: (event: any, data: { type: string; path: string; filename: string }) => void): void {
    if (this.isElectron()) {
      this.ipcRenderer.on('file-changed', callback);
    }
  }

  removeFileChangedListener(callback: (event: any, data: any) => void): void {
    if (this.isElectron()) {
      this.ipcRenderer.removeListener('file-changed', callback);
    }
  }

  // Recent projects storage (file-based, persists across restarts)
  async getRecentProjects(): Promise<Array<{ path: string; lastAccessed: string }>> {
    if (!this.isElectron()) {
      return [];
    }
    return await this.ipcRenderer.invoke('get-recent-projects');
  }

  async saveRecentProjects(projects: Array<{ path: string; lastAccessed: string }>): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('save-recent-projects', projects);
  }

  async openFileInEditor(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('open-file-in-editor', filePath);
  }

  async showItemInFolder(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('show-item-in-folder', filePath);
  }
}