import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';

describe('LoggingService.error toast text', () => {
  let notifications: jasmine.SpyObj<NotificationService>;
  let service: LoggingService;

  beforeEach(() => {
    notifications = jasmine.createSpyObj('NotificationService', ['showError']);
    service = new LoggingService(notifications);
    spyOn(console, 'error');
  });

  const toastFor = (message: string, error?: unknown) => {
    service.error(message, error);
    return notifications.showError.calls.mostRecent().args[0];
  };

  it('combines the context and the reason', () => {
    expect(toastFor('Failed to save book:', new Error('Code taken'))).toBe('Failed to save book: Code taken');
    expect(toastFor('Failed to save book', 'Code taken')).toBe('Failed to save book: Code taken');
  });

  it('does not repeat a context the reason already contains', () => {
    expect(toastFor('Failed to save book:', new Error('Failed to save book: Code taken'))).toBe(
      'Failed to save book: Code taken'
    );
  });

  it('strips an "Error: " prefix from the reason', () => {
    expect(toastFor('Failed to save book:', 'Error: Code taken')).toBe('Failed to save book: Code taken');
  });

  it('falls back to the context, or a generic text', () => {
    expect(toastFor('Failed to load locations:')).toBe('Failed to load locations');
    expect(toastFor('Failed to load locations:', { code: 'EIO' })).toBe('Failed to load locations');
    expect(toastFor('', undefined)).toBe('Something went wrong');
  });

  it('still logs to the console', () => {
    const err = new Error('x');
    service.error('Failed:', err);
    expect(console.error).toHaveBeenCalledWith('Failed:', err);
  });
});
