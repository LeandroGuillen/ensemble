import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type ChoiceResult = 'primary' | 'secondary' | 'cancel';

export interface ConfirmationRequest {
  id: string;
  message: string;
  title: string;
  confirmText?: string;
  cancelText?: string;
  /** Optional middle action (e.g. "Reload from disk"). When set, Cancel / Secondary / Confirm are shown. */
  secondaryText?: string;
  checkbox?: { label: string; checked: boolean };
  danger?: boolean;
  resolve: (value: boolean | 'secondary') => void;
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
  /** Ensures a second confirm waits until the first dialog fully settles. */
  private confirmSerial: Promise<void> = Promise.resolve();

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
    const result = await this.open({
      message,
      title,
      confirmText: options?.confirmText,
      cancelText: options?.cancelText,
      danger: options?.danger ?? false,
    });
    return result === 'primary';
  }

  /**
   * Three-way choice: primary, secondary, or cancel (Escape / dismiss).
   * Used when leaving a book plan with an unresolved disk conflict.
   */
  async choose(
    message: string,
    title: string,
    options: {
      confirmText: string;
      secondaryText: string;
      cancelText?: string;
      danger?: boolean;
    }
  ): Promise<ChoiceResult> {
    return this.open({
      message,
      title,
      confirmText: options.confirmText,
      secondaryText: options.secondaryText,
      cancelText: options.cancelText,
      danger: options.danger ?? false,
    });
  }

  async confirmLinkRename(message: string): Promise<{ update: boolean; alias: boolean }> {
    const checkbox = { label: 'Add old name as alias', checked: false };
    const result = await this.open({ message, title: 'Update wiki links?', confirmText: 'Update links', cancelText: 'Keep links unchanged', checkbox });
    return { update: result === 'primary', alias: result === 'primary' && checkbox.checked };
  }

  private open(request: Omit<ConfirmationRequest, 'id' | 'resolve'>): Promise<ChoiceResult> {
    const show = (): Promise<ChoiceResult> =>
      new Promise<ChoiceResult>((resolve) => {
        this.confirmationSubject.next({
          id: `confirmation-${Date.now()}-${Math.random()}`,
          ...request,
          resolve: (value) => {
            // Defer until after ConfirmationDialogComponent.close() on the same click.
            queueMicrotask(() => {
              if (value === true) resolve('primary');
              else if (value === 'secondary') resolve('secondary');
              else resolve('cancel');
            });
          },
        });
      });

    const chained = this.confirmSerial.then(show);
    this.confirmSerial = chained.then(
      () => undefined,
      () => undefined
    );
    return chained;
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
