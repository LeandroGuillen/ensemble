import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Notification } from '../../core/services/notification.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification.component.html',
  styleUrls: ['./notification.component.scss']
})
export class NotificationComponent implements OnInit, OnDestroy {
  notifications: Notification[] = [];
  private destroy$ = new Subject<void>();

  constructor(private notificationService: NotificationService) {}

  ngOnInit(): void {
    this.notificationService.notifications$
      .pipe(takeUntil(this.destroy$))
      .subscribe(notification => {
        this.addNotification(notification);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private addNotification(notification: Notification): void {
    this.notifications.push(notification);

    // Auto-dismiss if duration is set
    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        this.removeNotification(notification.id);
      }, notification.duration);
    }
  }

  removeNotification(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
  }

  getIconClass(type: string): string {
    switch (type) {
      case 'success':
        return 'icon-check';
      case 'error':
        return 'icon-alert-circle';
      case 'warning':
        return 'icon-alert-triangle';
      case 'info':
        return 'icon-info';
      default:
        return 'icon-info';
    }
  }
}

