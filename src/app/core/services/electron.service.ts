import { Injectable } from '@angular/core';
import { IpcChannels } from '../ipc/ipc-channels';
import { LoggingService } from './logging.service';

declare global {
  interface Window {
    require: any;
  }
}

/** Standard return shape for IPC handlers in `main.js` (see B4). */
export interface IpcResult<T = void> {
  success: boolean;
  error?: string;
  data?: T;
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  private ipcRenderer: any;

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
    return await this.ipcRenderer.invoke(IpcChannels.createDirectory, dirPath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    if (!this.isElectron()) {
      return false;
    }
    return await this.ipcRenderer.invoke(IpcChannels.fileExists, filePath);
  }

  async isDirectory(dirPath: string): Promise<boolean> {
    if (!this.isElectron()) {
      return false;
    }
    return await this.ipcRenderer.invoke(IpcChannels.isDirectory, dirPath);
  }

  async readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.readFile, filePath);
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.writeFile, filePath, content);
  }

  async writeFileAtomic(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.writeFileAtomic, filePath, content);
  }

  /**
   * Tell the main process which project root is active so FS IPC handlers can
   * enforce the work-folder path sandbox (Batch G).
   */
  async setWorkFolder(folderPath: string | null): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.setWorkFolder, folderPath);
  }

  // Dialog operations
  async selectFolder(): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }
    return await this.ipcRenderer.invoke(IpcChannels.selectFolder);
  }

  async selectImage(): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }
    return await this.ipcRenderer.invoke(IpcChannels.selectImage);
  }

  async selectImages(): Promise<string[]> {
    if (!this.isElectron()) {
      return [];
    }
    return await this.ipcRenderer.invoke(IpcChannels.selectImages);
  }

  async selectJson(): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }
    return await this.ipcRenderer.invoke(IpcChannels.selectJson);
  }

  async getVersion(): Promise<string> {
    if (!this.isElectron()) {
      return '1.0.0';
    }
    return await this.ipcRenderer.invoke(IpcChannels.getVersion);
  }

  // Additional file operations needed for character management
  async deleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.deleteFile, filePath);
  }

  async listDirectory(dirPath: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.listDirectory, dirPath);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.copyFile, sourcePath, destPath);
  }

  async moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.moveFile, sourcePath, destPath);
  }

  async getFileStats(filePath: string): Promise<{ success: boolean; stats?: any; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.getFileStats, filePath);
  }

  async getImageAsDataUrl(filePath: string): Promise<string | null> {
    if (!this.isElectron()) {
      return null;
    }

    try {
      return await this.ipcRenderer.invoke(IpcChannels.getImageDataUrl, filePath);
    } catch (error) {
      this.logger.error('Failed to get image as data URL', error);
      return null;
    }
  }

  async aiRequest(url: string, options: any): Promise<any> {
    if (!this.isElectron()) {
      throw new Error('AI requests are only available in Electron');
    }
    return await this.ipcRenderer.invoke(IpcChannels.aiRequest, url, options);
  }

  async downloadImage(
    url: string,
    destinationPath: string,
    options: { headers?: Record<string, string>; timeout?: number } = {}
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.downloadImage, url, destinationPath, options);
  }

  async saveBase64Image(
    base64Data: string,
    destinationPath: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.saveBase64Image, base64Data, destinationPath);
  }

  async moveDirectory(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.moveDirectory, sourcePath, destPath);
  }

  async deleteDirectoryRecursive(dirPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.deleteDirectoryRecursive, dirPath);
  }

  async copyDirectoryRecursive(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.copyDirectoryRecursive, sourcePath, destPath);
  }

  async readDirectoryFiles(dirPath: string): Promise<{ success: boolean; files?: string[]; directories?: string[]; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.readDirectoryFiles, dirPath);
  }

  async readDirectoryRecursive(
    dirPath: string,
    pattern: string
  ): Promise<{ success: boolean; files?: Array<{ relativePath: string; absolutePath: string }>; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron', files: [] };
    }
    return await this.ipcRenderer.invoke(IpcChannels.readDirectoryRecursive, dirPath, pattern);
  }

  // File watching
  async startFileWatcher(projectPath: string, charactersFolder = 'characters'): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.startFileWatcher, projectPath, charactersFolder);
  }

  async stopFileWatcher(): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.stopFileWatcher);
  }

  onFileChanged(callback: (event: any, data: { type: string; path: string; filename: string }) => void): void {
    if (this.isElectron()) {
      this.ipcRenderer.on(IpcChannels.fileChanged, callback);
    }
  }

  removeFileChangedListener(callback: (event: any, data: any) => void): void {
    if (this.isElectron()) {
      this.ipcRenderer.removeListener(IpcChannels.fileChanged, callback);
    }
  }

  setBrowserNavigationInterception(enabled: boolean): void {
    if (this.isElectron()) {
      this.ipcRenderer.send(IpcChannels.setBrowserNavigationInterception, enabled);
    }
  }

  onBrowserNavigationCommand(
    callback: (event: any, direction: 'back' | 'forward') => void
  ): void {
    if (this.isElectron()) {
      this.ipcRenderer.on(IpcChannels.browserNavigationCommand, callback);
    }
  }

  removeBrowserNavigationCommandListener(
    callback: (event: any, direction: 'back' | 'forward') => void
  ): void {
    if (this.isElectron()) {
      this.ipcRenderer.removeListener(IpcChannels.browserNavigationCommand, callback);
    }
  }

  // Recent projects storage (file-based, persists across restarts)
  async getRecentProjects(): Promise<Array<{ path: string; lastAccessed: string }>> {
    if (!this.isElectron()) {
      return [];
    }
    return await this.ipcRenderer.invoke(IpcChannels.getRecentProjects);
  }

  async saveRecentProjects(projects: Array<{ path: string; lastAccessed: string }>): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.saveRecentProjects, projects);
  }

  async openFileInEditor(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.openFileInEditor, filePath);
  }

  async showItemInFolder(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.showItemInFolder, filePath);
  }

  /** Opens a folder in the OS file manager (opens the folder itself, not its parent). */
  async openPath(folderPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.openPath, folderPath);
  }

  // ==================== Auto-updater (B2) ====================
  // These wrap the updater IPC handlers in main.js. Renderer code should
  // always go through here rather than touching `ipcRenderer` directly.

  /** Subscribe to `update-status` events pushed from the main process. */
  onUpdateStatus(callback: (event: any, status: any) => void): void {
    if (this.isElectron()) {
      this.ipcRenderer.on(IpcChannels.updateStatus, callback);
    }
  }

  removeUpdateStatusListener(callback: (event: any, status: any) => void): void {
    if (this.isElectron()) {
      this.ipcRenderer.removeListener(IpcChannels.updateStatus, callback);
    }
  }

  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.checkForUpdates);
  }

  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.downloadUpdate);
  }

  async getUpdateStatus(): Promise<{ success: boolean; updateInfo?: any; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.getUpdateStatus);
  }

  async quitAndInstall(): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.quitAndInstall);
  }

  async copyUpdateToDownloads(updatePath: string): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.copyUpdateToDownloads, updatePath);
  }

  async openUpdateFolder(updatePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke(IpcChannels.openUpdateFolder, updatePath);
  }
}