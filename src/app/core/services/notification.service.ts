import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // Auto-dismiss after milliseconds (0 = no auto-dismiss)
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notificationsSubject = new Subject<Notification>();
  public notifications$ = this.notificationsSubject.asObservable();
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
   * Show an error notification
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
   * Show a notification
   */
  private show(notification: Notification): void {
    this.notificationsSubject.next(notification);
  }
}

