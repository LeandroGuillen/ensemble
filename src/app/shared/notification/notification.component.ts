import { ChangeDetectorRef, Component, OnInit, DestroyRef, inject } from '@angular/core';
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
  /** Notification ids whose action has already run (guards double-click). */
  private readonly actionFired = new Set<string>();
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private notificationService: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.notificationService.notifications$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(notification => {
        this.addNotification(notification);
        this.cdr.markForCheck();
      });

    this.notificationService.dismiss$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => {
        if (target === 'all') {
          this.notifications = [];
          this.actionFired.clear();
          this.cdr.markForCheck();
          return;
        }
        this.removeNotification(target);
        this.cdr.markForCheck();
      });
  }

  private addNotification(notification: Notification): void {
    this.notifications.push(notification);

    // Auto-dismiss if duration is set and positive. duration 0 = sticky.
    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        this.removeNotification(notification.id);
      }, notification.duration);
    }
  }

  removeNotification(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.actionFired.delete(id);
  }

  async onActionClick(notification: Notification): Promise<void> {
    if (!notification.action) {
      return;
    }
    if (this.actionFired.has(notification.id)) {
      return;
    }
    // Mark fired before removing so a sync double-click cannot re-enter
    // (removeNotification clears actionFired for the id).
    this.actionFired.add(notification.id);
    const action = notification.action;
    notification.action = undefined;
    this.removeNotification(notification.id);
    try {
      await action.run();
    } catch {
      // Action errors are the caller's responsibility; toast is already gone.
    }
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
