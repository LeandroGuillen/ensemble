import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface ConfirmationRequest {
  id: string;
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

/**
 * Modal service for user confirmations and alerts
 *
 * Uses custom confirmation dialogs instead of native browser dialogs
 * for better UX and consistency.
 */
@Injectable({
  providedIn: 'root'
})
export class ModalService {
  private confirmationSubject = new Subject<ConfirmationRequest>();
  public confirmation$: Observable<ConfirmationRequest> = this.confirmationSubject.asObservable();

  /**
   * Shows a confirmation dialog
   * @param message - The message to display
   * @param title - Optional title
   * @param options - Optional configuration (confirmText, cancelText, danger)
   * @returns Promise resolving to true if confirmed, false if cancelled
   */
  async confirm(
    message: string, 
    title = 'Confirm',
    options?: {
      confirmText?: string;
      cancelText?: string;
      danger?: boolean;
    }
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const request: ConfirmationRequest = {
        id: `confirmation-${Date.now()}-${Math.random()}`,
        message,
        title,
        confirmText: options?.confirmText,
        cancelText: options?.cancelText,
        danger: options?.danger ?? false,
        resolve
      };
      this.confirmationSubject.next(request);
    });
  }

  /**
   * Shows an alert dialog
   * @param message - The message to display
   * @param title - Optional title
   */
  async alert(message: string, title = 'Alert'): Promise<void> {
    // For now, use native alert. Can be replaced with custom dialog later
    window.alert(`${title}\n\n${message}`);
  }

  /**
   * Shows a prompt dialog
   * @param message - The message to display
   * @param defaultValue - Default input value
   * @returns Promise resolving to the entered value, or null if cancelled
   */
  async prompt(message: string, defaultValue = ''): Promise<string | null> {
    // For now, use native prompt. Can be replaced with custom dialog later
    return window.prompt(message, defaultValue);
  }
}
