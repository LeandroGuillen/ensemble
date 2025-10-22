import { Injectable } from '@angular/core';

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

  constructor() {
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
    
    try {
      return await this.ipcRenderer.invoke('delete-file', filePath);
    } catch (error) {
      // Fallback to direct fs access
      return await this.fallbackDeleteFile(filePath);
    }
  }

  private async fallbackDeleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.isElectron() && window.require) {
        const fs = window.require('fs');
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          return { success: true };
        } else {
          return { success: false, error: 'File does not exist' };
        }
      }
    } catch (error) {
      return { success: false, error: `Delete failed: ${error}` };
    }
    
    return { success: false, error: 'File deletion not available' };
  }

  async listDirectory(dirPath: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    
    try {
      return await this.ipcRenderer.invoke('list-directory', dirPath);
    } catch (error) {
      // If the handler is not implemented, try a fallback approach
      console.warn('list-directory handler not implemented, trying fallback approach');
      return await this.fallbackListDirectory(dirPath);
    }
  }

  private async fallbackListDirectory(dirPath: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    try {
      // Try using Node.js fs module directly if available in Electron renderer
      if (this.isElectron() && window.require) {
        const fs = window.require('fs');
        const path = window.require('path');
        
        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
          return { success: false, error: 'Directory does not exist' };
        }
        
        // Read directory contents
        const files = fs.readdirSync(dirPath);
        
        // Filter for markdown files
        const markdownFiles = files.filter((f: string) => f.endsWith('.md'));
        
        return { success: true, files: markdownFiles };
      }
    } catch (error) {
      // Silent fallback - direct fs access not available
    }

    // If direct fs access fails, we're stuck with pattern matching for now
    return { success: false, error: 'Directory listing not available - Electron main process handlers needed' };
  }

  async copyFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    
    try {
      return await this.ipcRenderer.invoke('copy-file', sourcePath, destPath);
    } catch (error) {
      // Fallback to direct fs access
      return await this.fallbackCopyFile(sourcePath, destPath);
    }
  }

  private async fallbackCopyFile(sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.isElectron() && window.require) {
        const fs = window.require('fs');
        const path = window.require('path');
        
        // Ensure destination directory exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        // Copy file
        fs.copyFileSync(sourcePath, destPath);
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: `Copy failed: ${error}` };
    }
    
    return { success: false, error: 'File copying not available' };
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
      console.error('Failed to get image as data URL:', error);
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

  async readDirectoryFiles(dirPath: string): Promise<{ success: boolean; files?: string[]; directories?: string[]; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('read-directory-files', dirPath);
  }

  // File watching
  async startFileWatcher(projectPath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('start-file-watcher', projectPath);
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
  async getRecentProjects(): Promise<string[]> {
    if (!this.isElectron()) {
      return [];
    }
    return await this.ipcRenderer.invoke('get-recent-projects');
  }

  async saveRecentProjects(projects: string[]): Promise<{ success: boolean; error?: string }> {
    if (!this.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }
    return await this.ipcRenderer.invoke('save-recent-projects', projects);
  }
}