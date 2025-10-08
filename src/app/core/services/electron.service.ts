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
  private ipcRenderer: any;

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
}