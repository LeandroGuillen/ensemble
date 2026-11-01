import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface NotificationAction {
  label: string;
  run: () => void | Promise<void>;
}

/** Window in which an error/warning that repeats a visible one is merged into it. */
export const DUPLICATE_WINDOW_MS = 1500;

/**
 * Toast text cleanup shared by every toast: `${error}` on an Error object yields
 * "Error: <message>", so "Failed to save: Error: x" becomes "Failed to save: x".
 */
export function normalizeNotificationMessage(message: string): string {
  return String(message ?? '')
    .replace(/^\s*(?:Error:\s+)+/, '')
    .replace(/:\s*(?:Error:\s+)+/g, ': ')
    .trim();
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

  /** Recent error/warning toasts, for merging duplicates of one failure. */
  private recent: { id: string; type: Notification['type']; key: string; at: number }[] = [];

  /** Clock for the duplicate window (overridable in tests). */
  now: () => number = () => Date.now();

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
    this.recent = this.recent.filter((r) => r.id !== id);
    this.dismissSubject.next(id);
  }

  /** Dismiss every visible notification. */
  dismissAll(): void {
    this.recent = [];
    this.dismissSubject.next('all');
  }

  /**
   * Show a notification
   */
  private show(notification: Notification): void {
    const message = normalizeNotificationMessage(notification.message);
    const toast = { ...notification, message };

    // One failure, one toast: LoggingService.error toasts, and many callers
    // then toast the same failure again (often with added context). Merge an
    // error/warning that repeats a recent one of the same type, keeping the
    // more descriptive text.
    if (!toast.action && (toast.type === 'error' || toast.type === 'warning')) {
      const now = this.now();
      this.recent = this.recent.filter((r) => now - r.at <= DUPLICATE_WINDOW_MS);
      const key = message.toLowerCase();
      const dup = key
        ? this.recent.find(
            (r) => r.type === toast.type && r.key && (r.key.includes(key) || key.includes(r.key))
          )
        : undefined;
      if (dup) {
        if (key.length <= dup.key.length) {
          return; // Already showing this (or a fuller version of it).
        }
        this.dismiss(dup.id); // Replace with the more descriptive one.
      }
      this.recent.push({ id: toast.id, type: toast.type, key, at: now });
    }

    this.notificationsSubject.next(toast);
  }
}
