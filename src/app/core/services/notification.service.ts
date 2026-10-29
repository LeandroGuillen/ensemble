import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface NotificationAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // Auto-dismiss after milliseconds (0 = no auto-dismiss / sticky)
  action?: NotificationAction;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notificationsSubject = new Subject<Notification>();
  public notifications$ = this.notificationsSubject.asObservable();

  private dismissSubject = new Subject<string | 'all'>();
  public dismiss$ = this.dismissSubject.asObservable();

  private notificationId = 0;

  /**
   * Show a success notification
   */
  showSuccess(message: string, duration = 3000): void {
    this.show({
      id: `notification-${++this.notificationId}`,
      type: 'success',
      message,
      duration
    });
  }

  /**
   * Show an error notification.
   * Pass duration 0 for a sticky error (no auto-dismiss).
   */
  showError(message: string, duration = 5000): void {
    this.show({
      id: `notification-${++this.notificationId}`,
      type: 'error',
      message,
      duration
    });
  }

  /**
   * Show a warning notification
   */
  showWarning(message: string, duration = 4000): void {
    this.show({
      id: `notification-${++this.notificationId}`,
      type: 'warning',
      message,
      duration
    });
  }

  /**
   * Show an info notification
   */
  showInfo(message: string, duration = 3000): void {
    this.show({
      id: `notification-${++this.notificationId}`,
      type: 'info',
      message,
      duration
    });
  }

  /**
   * Show an Undo toast with an action button. Dismisses after durationMs.
   * Returns the notification id so callers can dismiss it explicitly.
   */
  showUndo(
    message: string,
    onUndo: () => void | Promise<void>,
    durationMs: number
  ): string {
    const id = `notification-${++this.notificationId}`;
    this.show({
      id,
      type: 'info',
      message,
      duration: durationMs,
      action: { label: 'Undo', run: onUndo },
    });
    return id;
  }

  /** Dismiss one notification by id. */
  dismiss(id: string): void {
    this.dismissSubject.next(id);
  }

  /** Dismiss every visible notification. */
  dismissAll(): void {
    this.dismissSubject.next('all');
  }

  /**
   * Show a notification
   */
  private show(notification: Notification): void {
    this.notificationsSubject.next(notification);
  }
}
