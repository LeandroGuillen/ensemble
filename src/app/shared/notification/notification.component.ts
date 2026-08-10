import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { NotificationService, Notification } from '../../core/services/notification.service';
@Component({
    selector: 'app-notification',
    imports: [],
    templateUrl: './notification.component.html',
    styleUrls: ['./notification.component.scss']
})
export class NotificationComponent implements OnInit {
  notifications: Notification[] = [];
  private readonly destroyRef = inject(DestroyRef);

  constructor(private notificationService: NotificationService) {}

  ngOnInit(): void {
    this.notificationService.notifications$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(notification => {
        this.addNotification(notification);
      });
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

