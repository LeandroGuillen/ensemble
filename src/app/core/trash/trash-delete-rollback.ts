import { UndoDeleteEntry, UndoDeleteService } from '../services/undo-delete.service';
import { ElectronService } from '../services/electron.service';
import { NotificationService } from '../services/notification.service';
import { trashOrphanStickyMessage } from './trash-record-id';

export type RestoreStagedOutcome = 'restored' | 'undo-registered' | 'sticky';

/**
 * After a post-stage failure: try restoreFromTrash (clears the commit timer).
 * On restore failure, register Undo if an entry is provided; otherwise sticky
 * error naming `<project>/.ensemble-trash/`.
 */
export async function restoreStagedOrOfferUndo(options: {
  electron: Pick<ElectronService, 'restoreFromTrash'>;
  undoDelete: Pick<UndoDeleteService, 'register'>;
  notifications: Pick<NotificationService, 'showError'>;
  token: string;
  name: string;
  projectPath: string;
  /** Built only when restore fails — entry still staged, Undo can finish the job. */
  buildUndoEntry?: () => UndoDeleteEntry;
}): Promise<RestoreStagedOutcome> {
  const restoreResult = await options.electron.restoreFromTrash(options.token);
  if (restoreResult?.success) {
    return 'restored';
  }

  if (options.buildUndoEntry) {
    try {
      options.undoDelete.register(options.token, options.buildUndoEntry());
      return 'undo-registered';
    } catch {
      // fall through to sticky
    }
  }

  options.notifications.showError(
    trashOrphanStickyMessage(options.name, options.projectPath),
    0
  );
  return 'sticky';
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || 'Unknown error');
}
