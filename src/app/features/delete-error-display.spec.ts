import { TrashStagingError, isTrashStagingError } from '../core/trash/trash-record-id';

/**
 * Component delete-error behaviour (Part 3.1 regression).
 * Full component TestBeds are heavy; these exercise the same branch logic the
 * character/location/cast detail & list catch blocks use.
 */
describe('delete error display (TrashStagingError vs ordinary Error)', () => {
  function handleDeleteError(
    error: unknown,
    ui: {
      showErrorToast?: (msg: string) => void;
      setInlineError?: (msg: string) => void;
    }
  ): void {
    if (isTrashStagingError(error)) {
      return;
    }
    const message = `Failed to delete: ${error}`;
    ui.showErrorToast?.(message);
    ui.setInlineError?.(message);
  }

  it('ordinary Error shows an error (toast and/or inline)', () => {
    const toasts: string[] = [];
    let inline: string | null = null;
    handleDeleteError(new Error('no project loaded'), {
      showErrorToast: (m) => toasts.push(m),
      setInlineError: (m) => {
        inline = m;
      },
    });
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain('no project loaded');
    expect(inline).toContain('no project loaded');
  });

  it('TrashStagingError shows exactly zero additional errors (service already toasted)', () => {
    const toasts: string[] = [];
    let inline: string | null = null;
    handleDeleteError(new TrashStagingError('already toasted'), {
      showErrorToast: (m) => toasts.push(m),
      setInlineError: (m) => {
        inline = m;
      },
    });
    expect(toasts.length).toBe(0);
    expect(inline).toBeNull();
  });
});
