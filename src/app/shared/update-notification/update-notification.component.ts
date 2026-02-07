import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpdateService, UpdateStatus } from '../../core/services/update.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-update-notification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './update-notification.component.html',
  styleUrls: ['./update-notification.component.scss']
})
export class UpdateNotificationComponent implements OnInit, OnDestroy {
  updateStatus: UpdateStatus | null = null;
  isVisible = false;
  private destroy$ = new Subject<void>();

  constructor(private updateService: UpdateService) {}

  ngOnInit(): void {
    this.updateService.updateStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.updateStatus = status;
        // Show notification for relevant statuses
        this.isVisible = status.status === 'available' || 
                        status.status === 'downloading' || 
                        status.status === 'downloaded' ||
                        status.status === 'error';
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async onDownload(): Promise<void> {
    const result = await this.updateService.downloadUpdate();
    if (!result.success) {
      console.error('Failed to download update:', result.error);
    }
  }

  async onInstall(): Promise<void> {
    // For AppImage, we show instructions and quit
    const result = await this.updateService.quitAndInstall();
    if (!result.success) {
      console.error('Failed to quit for install:', result.error);
    }
  }

  onDismiss(): void {
    this.isVisible = false;
  }

  onViewReleaseNotes(): void {
    if (this.updateStatus?.releaseNotes) {
      // Open release notes in browser or show in dialog
      // For now, we'll just log it - can be enhanced later
      console.log('Release notes:', this.updateStatus.releaseNotes);
    }
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  getTitle(): string {
    if (!this.updateStatus) return 'Update';
    
    switch (this.updateStatus.status) {
      case 'available':
        return 'Update Available';
      case 'downloading':
        return 'Downloading Update';
      case 'downloaded':
        return 'Update Ready';
      case 'error':
        return 'Update Error';
      default:
        return 'Update';
    }
  }
}

