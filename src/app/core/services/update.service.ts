import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  message?: string;
  currentVersion?: string;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: {
    percent: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

type UpdateResult = { success: boolean; error?: string };

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
    this.electronService.onUpdateStatus((event: any, status: UpdateStatus) => {
      this.updateStatusSubject.next(status);
      this.logger.log('Update status changed:', status);
    });
  }

  checkForUpdates(): Promise<UpdateResult> {
    return this.run('checking for updates', () => this.electronService.checkForUpdates());
  }

  downloadUpdate(): Promise<UpdateResult> {
    return this.run('downloading update', () => this.electronService.downloadUpdate());
  }

  /** Quit and install the downloaded update. */
  quitAndInstall(): Promise<UpdateResult> {
    return this.run('quitting for install', () => this.electronService.quitAndInstall());
  }

  private async run(action: string, call: () => Promise<UpdateResult>): Promise<UpdateResult> {
    try {
      return await call();
    } catch (error: any) {
      this.logger.error(`Error ${action}`, error);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  }
}
