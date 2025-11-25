import { Injectable } from '@angular/core';

/**
 * Modal service for user confirmations and alerts
 *
 * Wraps native browser dialogs for easier testing and future replacement
 * with custom modal components.
 */
@Injectable({
  providedIn: 'root'
})
export class ModalService {
  /**
   * Shows a confirmation dialog
   * @param message - The message to display
   * @param title - Optional title (prepended to message)
   * @returns Promise resolving to true if confirmed, false if cancelled
   */
  async confirm(message: string, title = 'Confirm'): Promise<boolean> {
    return window.confirm(`${title}\n\n${message}`);
  }

  /**
   * Shows an alert dialog
   * @param message - The message to display
   * @param title - Optional title (prepended to message)
   */
  async alert(message: string, title = 'Alert'): Promise<void> {
    window.alert(`${title}\n\n${message}`);
  }

  /**
   * Shows a prompt dialog
   * @param message - The message to display
   * @param defaultValue - Default input value
   * @returns Promise resolving to the entered value, or null if cancelled
   */
  async prompt(message: string, defaultValue = ''): Promise<string | null> {
    return window.prompt(message, defaultValue);
  }
}
