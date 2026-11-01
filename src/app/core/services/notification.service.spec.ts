import { DUPLICATE_WINDOW_MS, Notification, NotificationService, normalizeNotificationMessage } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let shown: Notification[];
  let dismissed: string[];
  let clock: number;

  beforeEach(() => {
    service = new NotificationService();
    clock = 1_000;
    service.now = () => clock;
    shown = [];
    dismissed = [];
    service.notifications$.subscribe((n) => shown.push(n));
    service.dismiss$.subscribe((id) => dismissed.push(id));
  });

  it('strips the "Error: " prefix that `${error}` adds', () => {
    expect(normalizeNotificationMessage('Failed to save book: Error: Code taken')).toBe('Failed to save book: Code taken');
    expect(normalizeNotificationMessage('Error: Code taken')).toBe('Code taken');
    expect(normalizeNotificationMessage('Failed: Error: Error: x')).toBe('Failed: x');
    expect(normalizeNotificationMessage('Error handling is fine')).toBe('Error handling is fine');
    service.showError('Failed to save book: Error: Code taken');
    expect(shown[0].message).toBe('Failed to save book: Code taken');
  });

  it('shows one toast when the same failure is reported twice', () => {
    service.showError('Failed to save book: Code taken');
    service.showError('Failed to save book: Error: Code taken');
    expect(shown.map((n) => n.message)).toEqual(['Failed to save book: Code taken']);
    expect(dismissed).toEqual([]);
  });

  it('keeps the more descriptive toast: a bare reason is replaced by "context: reason"', () => {
    service.showError('Code taken');
    service.showError('Failed to save book: Code taken');
    expect(shown.map((n) => n.message)).toEqual(['Code taken', 'Failed to save book: Code taken']);
    expect(dismissed).toEqual([shown[0].id]);
  });

  it('drops a bare reason that arrives after the descriptive toast', () => {
    service.showError('Failed to save book: Code taken');
    service.showError('Code taken');
    expect(shown.length).toBe(1);
  });

  it('shows the same text again after the duplicate window', () => {
    service.showError('Disk full');
    clock += DUPLICATE_WINDOW_MS + 1;
    service.showError('Disk full');
    expect(shown.length).toBe(2);
  });

  it('shows it again once the first was dismissed', () => {
    service.showError('Disk full');
    service.dismiss(shown[0].id);
    service.showError('Disk full');
    expect(shown.length).toBe(2);
  });

  it('does not merge different failures, different types, successes or Undo toasts', () => {
    service.showError('Failed to save book: Code taken');
    service.showError('Failed to delete saga: In use');
    service.showWarning('Failed to save book: Code taken');
    service.showSuccess('Saved');
    service.showSuccess('Saved');
    service.showUndo('Deleted "Mara".', () => {}, 15000);
    service.showUndo('Deleted "Mara".', () => {}, 15000);
    expect(shown.length).toBe(7);
  });

  it('never merges an empty message with others', () => {
    service.showError('');
    service.showError('Disk full');
    service.showError('');
    expect(shown.length).toBe(3);
  });
});
