import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { NotificationService } from './notification.service';

/**
 * Centralized logging service
 * 
 * - console.log: Only in development mode
 * - console.error: Always logged + user notification
 * - console.warn: Kept as-is for development warnings
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
   * Extract user-friendly message from error
   */
  private extractUserMessage(message: string, error?: any): string {
    // If error is a string, use it
    if (typeof error === 'string') {
      return error;
    }
    
    // If error has a message, use it
    if (error?.message) {
      return error.message;
    }
    
    // Otherwise use the provided message
    return message;
  }
}

