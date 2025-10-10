import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

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
  
  private watcher: any = null;
  private isWatching = false;

  constructor() {}

  async startWatching(projectPath: string): Promise<void> {
    if (this.isWatching) {
      await this.stopWatching();
    }

    try {
      // TODO: Implement chokidar file watching
      console.log('Starting file watcher for:', projectPath);
      this.isWatching = true;
      
      // Mock file change events for development
      // In real implementation, this would use chokidar to watch the file system
    } catch (error) {
      console.error('Failed to start file watcher:', error);
      throw error;
    }
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      // TODO: Implement watcher cleanup
      console.log('Stopping file watcher');
      this.watcher = null;
    }
    this.isWatching = false;
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