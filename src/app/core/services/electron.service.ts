import { Subject } from 'rxjs';
import { Injectable, inject } from '@angular/core';
import { IpcChannels } from '../ipc/ipc-channels';
import { LoggingService } from './logging.service';
import { BackupSnapshot } from '../interfaces/backup.interface';

import { ProjectWriteProtectionService, READ_ONLY_PROJECT_MESSAGE } from './project-write-protection.service';

declare global {
  interface Window {
    require: any;
  }
}

type IpcResult = { success: boolean; error?: string };
const OFFLINE = { success: false, error: 'Not running in Electron' } as const;
const READ_ONLY = { success: false, error: READ_ONLY_PROJECT_MESSAGE } as const;

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  private ipcRenderer: any;
  private readonly writeProtection = inject(ProjectWriteProtectionService);
  /** Successful renderer writes, including book pages without a collection emission. */
  readonly filesWritten$ = new Subject<string>();

  constructor(private logger: LoggingService) {
    if (this.isElectron()) {
      this.ipcRenderer = window.require('electron').ipcRenderer;
    }
  }

  isElectron(): boolean {
    return !!(window && window.require);
  }

  /** Invoke a main-process handler; outside Electron, resolve to `fallback` instead. */
  private invoke<T>(channel: string, fallback: T, ...args: unknown[]): Promise<T> {
    return this.isElectron() ? this.ipcRenderer.invoke(channel, ...args) : Promise.resolve(fallback);
  }

  // File system operations
  async createDirectory(dirPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(dirPath)) return READ_ONLY;
    return this.invoke(IpcChannels.createDirectory, OFFLINE, dirPath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.invoke(IpcChannels.fileExists, false, filePath);
  }

  /** True when the file (or a new file at that path) can be written. */
  async isWritable(targetPath: string): Promise<boolean> {
    return this.invoke(IpcChannels.isWritable, false, targetPath);
  }

  async isDirectory(dirPath: string): Promise<boolean> {
    return this.invoke(IpcChannels.isDirectory, false, dirPath);
  }

  async readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    return this.invoke(IpcChannels.readFile, OFFLINE, filePath);
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(filePath)) return READ_ONLY;
    const result = await this.invoke<IpcResult>(IpcChannels.writeFile, OFFLINE, filePath, content);
    if (result.success) this.filesWritten$.next(filePath);
    return result;
  }

  async rewriteWikiLinks(changes: { path: string; expected: string; content: string }[]): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(...changes.map(change => change.path))) return READ_ONLY;
    const result = await this.invoke<IpcResult>(IpcChannels.rewriteWikiLinks, OFFLINE, changes);
    if (result.success) for (const change of changes) this.filesWritten$.next(change.path);
    return result;
  }

  async writeFileAtomic(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(filePath)) return READ_ONLY;
    const result = await this.invoke<IpcResult>(IpcChannels.writeFileAtomic, OFFLINE, filePath, content);
    if (result.success) this.filesWritten$.next(filePath);
    return result;
  }

  /** Tell the main process which project root is active (file IPC path guard). */
  async setWorkFolder(folderPath: string | null): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.setWorkFolder, OFFLINE, folderPath);
  }

  /**
   * The folder to open for `folderPath`. The committed demo project inside a git checkout
   * resolves to its writable copy under the app's user data folder; anything else to itself.
   */
  async resolveProjectFolder(folderPath: string): Promise<{ success: boolean; path?: string; demoCopy?: boolean; error?: string }> {
    return this.invoke(IpcChannels.resolveProjectFolder, { success: true, path: folderPath, demoCopy: false }, folderPath);
  }

  // Dialog operations
  async selectFolder(): Promise<string | null> {
    return this.invoke(IpcChannels.selectFolder, null);
  }

  async selectImage(): Promise<string | null> {
    return this.invoke(IpcChannels.selectImage, null);
  }

  async selectImages(): Promise<string[]> {
    return this.invoke(IpcChannels.selectImages, []);
  }

  async selectJson(): Promise<string | null> {
    return this.invoke(IpcChannels.selectJson, null);
  }

  async selectPath(options: { kind: 'markdown' | 'folder'; title?: string; defaultPath?: string }): Promise<string | null> {
    return this.invoke(IpcChannels.selectPath, null, options);
  }

  async getVersion(): Promise<string> {
    return this.invoke(IpcChannels.getVersion, '1.0.0');
  }

  // Additional file operations needed for character management
  async deleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(filePath)) return READ_ONLY;
    return this.invoke(IpcChannels.deleteFile, OFFLINE, filePath);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(destPath)) return READ_ONLY;
    return this.invoke(IpcChannels.copyFile, OFFLINE, sourcePath, destPath);
  }

  async moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(sourcePath, destPath)) return READ_ONLY;
    return this.invoke(IpcChannels.moveFile, OFFLINE, sourcePath, destPath);
  }

  async getFileStats(filePath: string): Promise<{ success: boolean; stats?: any; error?: string }> {
    return this.invoke(IpcChannels.getFileStats, OFFLINE, filePath);
  }

  async getImageAsDataUrl(filePath: string): Promise<string | null> {
    try {
      return await this.invoke(IpcChannels.getImageDataUrl, null, filePath);
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
    if (this.writeProtection.blocks(destinationPath)) return READ_ONLY;
    return this.invoke(IpcChannels.downloadImage, OFFLINE, url, destinationPath, options);
  }

  async saveBase64Image(
    base64Data: string,
    destinationPath: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (this.writeProtection.blocks(destinationPath)) return READ_ONLY;
    return this.invoke(IpcChannels.saveBase64Image, OFFLINE, base64Data, destinationPath);
  }

  async moveDirectory(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(sourcePath, destPath)) return READ_ONLY;
    return this.invoke(IpcChannels.moveDirectory, OFFLINE, sourcePath, destPath);
  }

  async deleteDirectoryRecursive(dirPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(dirPath)) return READ_ONLY;
    return this.invoke(IpcChannels.deleteDirectoryRecursive, OFFLINE, dirPath);
  }

  /** Stage a path for recoverable delete (main-process trash manager). */
  async stageForTrash(
    projectPath: string,
    targetPath: string,
    meta: { kind: string; recordId: string; name: string }
  ): Promise<{ success: boolean; token?: string; stagedPath?: string; expiresAt?: number; error?: string }> {
    if (this.writeProtection.blocks(targetPath)) return READ_ONLY;
    return this.invoke(IpcChannels.trashStage, OFFLINE, projectPath, targetPath, meta);
  }

  /** Restore a staged trash entry within the undo window. */
  async restoreFromTrash(token: string): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.trashRestore, OFFLINE, token);
  }

  /** Commit a staged trash entry to the OS trash immediately. */
  async commitTrash(token: string): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.trashCommit, OFFLINE, token);
  }

  /** Listen for trash-commit-failed events from main. */
  onTrashCommitFailed(
    callback: (
      event: any,
      data: { token: string; name: string; stagedPath: string; error: string }
    ) => void
  ): void {
    this.ipcRenderer?.on(IpcChannels.trashCommitFailed, callback);
  }

  /** Create a zip snapshot of the project folder (main-process backup manager). */
  async createBackupSnapshot(
    projectPath: string,
    destDir?: string
  ): Promise<{ success: boolean; snapshot?: BackupSnapshot; error?: string; errorCode?: string }> {
    return this.invoke(IpcChannels.backupCreate, OFFLINE, projectPath, destDir);
  }

  /** Restore a snapshot into a brand-new folder, never over the live project. */
  async restoreBackupSnapshot(
    zipPath: string,
    destParentDir: string,
    restoredName?: string
  ): Promise<{ success: boolean; folderPath?: string; entryCount?: number; name?: string; error?: string }> {
    return this.invoke(IpcChannels.backupRestore, OFFLINE, zipPath, destParentDir, restoredName);
  }

  /** List the snapshots in a backup folder, newest first. */
  async listBackupSnapshots(
    dir: string,
    projectPath?: string
  ): Promise<{ success: boolean; snapshots?: BackupSnapshot[]; error?: string }> {
    return this.invoke(IpcChannels.backupListSnapshots, OFFLINE, dir, projectPath);
  }

  /** Keep only the newest `keepN` automatic snapshots in a backup folder. */
  async pruneBackupSnapshots(
    dir: string,
    keepN: number,
    projectPath?: string
  ): Promise<{ success: boolean; removed?: string[]; kept?: string[]; error?: string }> {
    return this.invoke(IpcChannels.backupPruneSnapshots, OFFLINE, dir, keepN, projectPath);
  }

  async copyDirectoryRecursive(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.writeProtection.blocks(destPath)) return READ_ONLY;
    return this.invoke(IpcChannels.copyDirectoryRecursive, OFFLINE, sourcePath, destPath);
  }

  async readDirectoryFiles(dirPath: string): Promise<{ success: boolean; files?: string[]; directories?: string[]; error?: string }> {
    return this.invoke(IpcChannels.readDirectoryFiles, OFFLINE, dirPath);
  }

  async readDirectoryRecursive(
    dirPath: string,
    pattern: string
  ): Promise<{ success: boolean; files?: Array<{ relativePath: string; absolutePath: string }>; error?: string }> {
    return this.invoke(IpcChannels.readDirectoryRecursive, { success: false, error: 'Not running in Electron', files: [] }, dirPath, pattern);
  }

  // File watching
  async startFileWatcher(
    projectPath: string,
    watchFolders: string[] | string = ['characters']
  ): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.startFileWatcher, OFFLINE, projectPath, watchFolders);
  }

  async stopFileWatcher(): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.stopFileWatcher, OFFLINE);
  }

  onFileChanged(callback: (event: any, data: { type: string; path: string; filename: string }) => void): void {
    this.ipcRenderer?.on(IpcChannels.fileChanged, callback);
  }

  removeFileChangedListener(callback: (event: any, data: any) => void): void {
    this.ipcRenderer?.removeListener(IpcChannels.fileChanged, callback);
  }

  setBrowserNavigationInterception(enabled: boolean): void {
    this.ipcRenderer?.send(IpcChannels.setBrowserNavigationInterception, enabled);
  }

  onBrowserNavigationCommand(
    callback: (event: any, direction: 'back' | 'forward') => void
  ): void {
    this.ipcRenderer?.on(IpcChannels.browserNavigationCommand, callback);
  }

  removeBrowserNavigationCommandListener(
    callback: (event: any, direction: 'back' | 'forward') => void
  ): void {
    this.ipcRenderer?.removeListener(IpcChannels.browserNavigationCommand, callback);
  }

  /**
   * Main process asks the renderer to flush / resolve leave (book plan) before
   * close, quit, or reload. Reply with {@link replyPrepareToLeaveAck} then
   * {@link replyPrepareToLeaveResult}.
   */
  onPrepareToLeaveRequest(callback: () => void): void {
    this.ipcRenderer?.on(IpcChannels.prepareToLeaveRequest, callback);
  }

  removePrepareToLeaveRequestListener(callback: () => void): void {
    this.ipcRenderer?.removeListener(IpcChannels.prepareToLeaveRequest, callback);
  }

  /** Ack so main stops the unresponsive fail-open timer while a modal is open. */
  replyPrepareToLeaveAck(): void {
    this.ipcRenderer?.send(IpcChannels.prepareToLeaveReply, { type: 'ack' });
  }

  replyPrepareToLeaveResult(allowed: boolean): void {
    this.ipcRenderer?.send(IpcChannels.prepareToLeaveReply, { type: 'result', allowed: Boolean(allowed) });
  }

  // Recent projects storage (file-based, persists across restarts)
  async getRecentProjects(): Promise<Array<{ path: string; lastAccessed: string }>> {
    return this.invoke(IpcChannels.getRecentProjects, []);
  }

  async saveRecentProjects(projects: Array<{ path: string; lastAccessed: string }>): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.saveRecentProjects, OFFLINE, projects);
  }

  async openFileInEditor(filePath: string): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.openFileInEditor, OFFLINE, filePath);
  }

  async showItemInFolder(filePath: string): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.showItemInFolder, OFFLINE, filePath);
  }

  /** Opens a folder in the OS file manager (opens the folder itself, not its parent). */
  async openPath(folderPath: string): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.openPath, OFFLINE, folderPath);
  }

  // ==================== Auto-updater ====================
  // These wrap the updater IPC handlers in lib/updater.js. Renderer code should
  // always go through here rather than touching `ipcRenderer` directly.

  /** Subscribe to `update-status` events pushed from the main process. */
  onUpdateStatus(callback: (event: any, status: any) => void): void {
    this.ipcRenderer?.on(IpcChannels.updateStatus, callback);
  }

  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.checkForUpdates, OFFLINE);
  }

  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.downloadUpdate, OFFLINE);
  }

  async quitAndInstall(): Promise<{ success: boolean; error?: string }> {
    return this.invoke(IpcChannels.quitAndInstall, OFFLINE);
  }
}