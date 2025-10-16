import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { ElectronService } from './electron.service';

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  filename: string;
}

@Injectable({
  providedIn: 'root'
})
export class FileWatcherService {
  private fileChangesSubject = new Subject<FileChangeEvent>();
  public fileChanges$ = this.fileChangesSubject.asObservable();

  private isWatching = false;
  private fileChangedCallback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;

  constructor(private electronService: ElectronService) {}

  async startWatching(projectPath: string): Promise<void> {
    if (this.isWatching) {
      await this.stopWatching();
    }

    try {
      console.log('Starting file watcher for:', projectPath);

      // Create callback to handle file change events from main process
      this.fileChangedCallback = (_event: any, data: { type: string; path: string; filename: string }) => {
        this.handleFileChange(data.type, data.path);
      };

      // Register listener for file change events
      this.electronService.onFileChanged(this.fileChangedCallback);

      // Start the file watcher in the main process
      const result = await this.electronService.startFileWatcher(projectPath);

      if (!result.success) {
        throw new Error(result.error || 'Failed to start file watcher');
      }

      this.isWatching = true;
      console.log('File watcher started successfully');
    } catch (error) {
      console.error('Failed to start file watcher:', error);
      throw error;
    }
  }

  async stopWatching(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    try {
      console.log('Stopping file watcher');

      // Remove event listener
      if (this.fileChangedCallback) {
        this.electronService.removeFileChangedListener(this.fileChangedCallback);
        this.fileChangedCallback = null;
      }

      // Stop the file watcher in the main process
      await this.electronService.stopFileWatcher();

      this.isWatching = false;
      console.log('File watcher stopped successfully');
    } catch (error) {
      console.error('Failed to stop file watcher:', error);
      this.isWatching = false;
    }
  }

  isCurrentlyWatching(): boolean {
    return this.isWatching;
  }

  private handleFileChange(eventType: string, filePath: string): void {
    const filename = filePath.split('/').pop() || '';
    
    // Only process relevant file types
    if (!this.isRelevantFile(filename)) {
      return;
    }

    const event: FileChangeEvent = {
      type: eventType as 'add' | 'change' | 'unlink',
      path: filePath,
      filename
    };

    this.fileChangesSubject.next(event);
  }

  private isRelevantFile(filename: string): boolean {
    return filename.endsWith('.md') ||
           filename === 'ensemble.json' ||
           filename.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null;
  }
}