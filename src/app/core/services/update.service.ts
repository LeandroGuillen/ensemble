import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  message?: string;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
  };
  error?: string;
  path?: string;
}

@Injectable({
  providedIn: 'root'
})
export class UpdateService {
  private updateStatusSubject = new BehaviorSubject<UpdateStatus>({
    status: 'idle'
  });
  
  public updateStatus$: Observable<UpdateStatus> = this.updateStatusSubject.asObservable();

  constructor(
    private electronService: ElectronService,
    private logger: LoggingService
  ) {
    // Listen for update status events from Electron
    if (this.electronService.isElectron()) {
      this.electronService.ipcRenderer.on('update-status', (event: any, status: UpdateStatus) => {
        this.updateStatusSubject.next(status);
        this.logger.log('Update status changed:', status);
      });
    }
  }

  /**
   * Manually check for updates
   */
  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    if (!this.electronService.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await this.electronService.ipcRenderer.invoke('check-for-updates');
      return result;
    } catch (error: any) {
      this.logger.error('Error checking for updates', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (!this.electronService.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await this.electronService.ipcRenderer.invoke('download-update');
      return result;
    } catch (error: any) {
      this.logger.error('Error downloading update', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Get current update status
   */
  async getUpdateStatus(): Promise<{ success: boolean; updateInfo?: any; error?: string }> {
    if (!this.electronService.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await this.electronService.ipcRenderer.invoke('get-update-status');
      return result;
    } catch (error: any) {
      this.logger.error('Error getting update status', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Quit and install update (for AppImage, user will need to manually replace)
   */
  async quitAndInstall(): Promise<{ success: boolean; error?: string }> {
    if (!this.electronService.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await this.electronService.ipcRenderer.invoke('quit-and-install');
      return result;
    } catch (error: any) {
      this.logger.error('Error quitting for install', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Get current update status observable
   */
  getCurrentStatus(): UpdateStatus {
    return this.updateStatusSubject.value;
  }

  /**
   * Copy downloaded update file to Downloads folder
   */
  async copyUpdateToDownloads(updatePath: string): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.electronService.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await this.electronService.ipcRenderer.invoke('copy-update-to-downloads', updatePath);
      return result;
    } catch (error: any) {
      this.logger.error('Error copying update to Downloads', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Open the folder containing the downloaded update file
   */
  async openUpdateFolder(updatePath: string): Promise<{ success: boolean; error?: string }> {
    if (!this.electronService.isElectron()) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await this.electronService.ipcRenderer.invoke('open-update-folder', updatePath);
      return result;
    } catch (error: any) {
      this.logger.error('Error opening update folder', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
}

