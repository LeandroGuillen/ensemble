import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { NotificationService } from './notification.service';

/**
 * Centralized logging service
 * 
 * - console.log: Only in development mode
 * - console.error: Always logged + user notification
 * - console.warn: Warnings are logged only in development
 */
@Injectable({
  providedIn: 'root'
})
export class LoggingService {
  constructor(private notificationService: NotificationService) {}

  /**
   * Log debug information (only in development)
   */
  log(message: string, ...args: any[]): void {
    if (!environment.production) {
      console.log(message, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (!environment.production) {
      console.warn(message, ...args);
    }
  }

  /**
   * Log errors and show user notification
   */
  error(message: string, error?: any): void {
    // Always log errors for debugging
    console.error(message, error);
    
    // Show user-friendly notification
    const userMessage = this.extractUserMessage(message, error);
    this.notificationService.showError(userMessage);
  }

  /**
   * Toast text: the context (`message`) plus the reason from `error`, e.g.
   * ("Failed to save book:", Error("Code taken")) → "Failed to save book: Code taken".
   * Falls back to whichever part exists; avoids repeating a reason that
   * already contains the context.
   */
  private extractUserMessage(message: string, error?: any): string {
    const context = (message || '').trim().replace(/[:\s]+$/, '');
    const reason =
      typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
    const detail = reason.trim().replace(/^(?:Error:\s+)+/, '');
    if (!detail) return context || 'Something went wrong';
    if (!context || detail.toLowerCase().includes(context.toLowerCase())) return detail;
    return `${context}: ${detail}`;
  }
}
