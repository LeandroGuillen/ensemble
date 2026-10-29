import { Injectable } from '@angular/core';
import { UNDO_WINDOW_MS } from '../trash/trash-constants';
import {
  CastDeleteSnapshot,
  CharacterReferenceSnapshot,
  LocationReferenceSnapshot,
  ReferenceRestoreResult,
} from '../interfaces/reference-snapshot.interface';
import { ElectronService } from './electron.service';
import { NotificationService } from './notification.service';
import { LoggingService } from './logging.service';

export type UndoDeleteKind = 'character' | 'draft' | 'lore' | 'location' | 'house' | 'cast' | string;

export type UndoReferenceSnapshot =
  | CharacterReferenceSnapshot
  | LocationReferenceSnapshot
  | CastDeleteSnapshot
  | null;

export interface UndoDeleteEntry {
  kind: UndoDeleteKind;
  recordId: string;
  name: string;
  referenceSnapshot: UndoReferenceSnapshot;
  notificationId?: string;
  /** Optional absolute expiry from stageForTrash; otherwise UNDO_WINDOW_MS from register. */
  expiresAt?: number;
  /** True when a same-id / same-name record already exists in the live collection. */
  hasConflict: () => boolean;
  /** Reload the restored record from disk into the right collection. */
  reload: () => Promise<void>;
  /** Reapply the reference snapshot; skips missing targets. */
  restoreReferences: (snapshot: UndoReferenceSnapshot) => Promise<ReferenceRestoreResult>;
}

const PATH_EXISTS_ERROR = 'Original path already exists';
const ALREADY_COMMITTED_ERRORS = [
  'Unknown trash token',
  'Trash entry already committed',
  'Trash entry commit already in progress',
];

/** Small margin after the undo window so main's commit can finish first. */
export const UNDO_ENTRY_EXPIRE_MARGIN_MS = 500;

function kindLabel(kind: string): string {
  if (!kind) return 'item';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatSkippedList(skipped: { label: string }[]): string {
  const labels = skipped.map((s) => s.label).filter(Boolean);
  if (labels.length <= 3) {
    return labels.join(', ');
  }
  return `${labels.slice(0, 3).join(', ')}, +${labels.length - 3} more`;
}

interface PendingUndoRecord {
  entry: UndoDeleteEntry;
  expireTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Renderer Undo plumbing for OS-trash deletes (Part 2).
 * Holds pending tokens, shows Undo toasts, and runs the Undo order.
 * No delete flow calls this yet — Part 3 wires it.
 */
@Injectable({
  providedIn: 'root',
})
export class UndoDeleteService {
  private readonly pending = new Map<string, PendingUndoRecord>();
  private subscribedToCommitFailed = false;

  constructor(
    private electronService: ElectronService,
    private notificationService: NotificationService,
    private logger: LoggingService
  ) {
    this.ensureCommitFailedSubscription();
  }

  /**
   * Register a staged delete and show the Undo toast for UNDO_WINDOW_MS.
   * Also arms an expiry timer (window + margin, or until expiresAt) so the
   * in-memory entry is dropped when main commits without a success event.
   */
  register(token: string, entry: UndoDeleteEntry): void {
    this.ensureCommitFailedSubscription();

    const kind = entry.kind || 'item';
    const name = entry.name || 'Untitled';
    const message = `${kindLabel(kind)} "${name}" moved to Trash.`;

    const notificationId = this.notificationService.showUndo(
      message,
      () => this.runUndo(token),
      UNDO_WINDOW_MS
    );

    const record: PendingUndoRecord = {
      entry: { ...entry, notificationId },
      expireTimer: null,
    };
    this.pending.set(token, record);
    this.armExpireTimer(token, entry.expiresAt);
  }

  /**
   * Drop every pending Undo window and dismiss only this service's toasts.
   * Call after loadProject / setWorkFolder (main already flushes staged entries).
   */
  dismissAll(): void {
    const notificationIds: string[] = [];
    for (const [token, record] of this.pending) {
      this.clearExpireTimer(record);
      if (record.entry.notificationId) {
        notificationIds.push(record.entry.notificationId);
      }
      this.pending.delete(token);
    }
    for (const id of notificationIds) {
      this.notificationService.dismiss(id);
    }
  }

  /** Test helper: whether a token is still awaiting Undo. */
  hasPending(token: string): boolean {
    return this.pending.has(token);
  }

  /** Test helper: number of pending Undo entries. */
  pendingCount(): number {
    return this.pending.size;
  }

  private armExpireTimer(token: string, expiresAt?: number): void {
    const record = this.pending.get(token);
    if (!record) {
      return;
    }
    this.clearExpireTimer(record);
    const delayMs =
      typeof expiresAt === 'number'
        ? Math.max(1, expiresAt - Date.now() + UNDO_ENTRY_EXPIRE_MARGIN_MS)
        : UNDO_WINDOW_MS + UNDO_ENTRY_EXPIRE_MARGIN_MS;
    record.expireTimer = setTimeout(() => {
      // Main has (or will have) committed; drop the renderer entry quietly.
      this.dropToken(token, { dismissToast: true });
    }, delayMs);
  }

  private clearExpireTimer(record: PendingUndoRecord): void {
    if (record.expireTimer != null) {
      clearTimeout(record.expireTimer);
      record.expireTimer = null;
    }
  }

  private ensureCommitFailedSubscription(): void {
    if (this.subscribedToCommitFailed) {
      return;
    }
    this.subscribedToCommitFailed = true;
    this.electronService.onTrashCommitFailed((_event, data) => {
      if (!data?.token) {
        return;
      }
      // Events may arrive for leftovers the renderer never staged — ignore unknown tokens.
      if (!this.pending.has(data.token)) {
        return;
      }
      this.dropToken(data.token);
    });
  }

  private dropToken(token: string, options: { dismissToast?: boolean } = {}): void {
    const dismissToast = options.dismissToast !== false;
    const record = this.pending.get(token);
    if (!record) {
      return;
    }
    this.clearExpireTimer(record);
    this.pending.delete(token);
    if (dismissToast && record.entry.notificationId) {
      this.notificationService.dismiss(record.entry.notificationId);
    }
  }

  private async runUndo(token: string): Promise<void> {
    const record = this.pending.get(token);
    if (!record) {
      return;
    }
    const entry = record.entry;

    const kind = entry.kind || 'item';
    const name = entry.name || 'Untitled';
    const conflictMessage =
      `Can't undo: a ${kind} named "${name}" already exists. ` +
      `The deleted copy stays in .ensemble-trash and moves to the system Trash when the undo window ends.`;

    // 1. Conflict check (same id / same name in the live collection).
    try {
      if (entry.hasConflict()) {
        this.notificationService.showError(conflictMessage);
        // Leave the token pending so the main-process timer still commits it.
        return;
      }
    } catch (error) {
      this.logger.error('Undo conflict check failed', error);
    }

    // 2. restoreFromTrash
    const restoreResult = await this.electronService.restoreFromTrash(token);
    if (!restoreResult.success) {
      const error = restoreResult.error || '';
      if (error === PATH_EXISTS_ERROR) {
        this.notificationService.showError(conflictMessage);
        return;
      }
      if (ALREADY_COMMITTED_ERRORS.some((msg) => error === msg || error.includes(msg))) {
        this.dropToken(token);
        this.notificationService.showError(
          `Can't undo: "${name}" was already moved to the system Trash.`
        );
        return;
      }
      this.notificationService.showError(`Couldn't undo "${name}": ${error}`);
      return;
    }

    this.dropToken(token, { dismissToast: false });

    // 3. Reload the record from disk.
    try {
      await entry.reload();
    } catch (error) {
      this.logger.error('Undo reload failed', error);
      this.notificationService.showError(
        `Restored files for "${name}" but couldn't reload it into the list.`
      );
      return;
    }

    // 4. Reapply reference snapshot.
    let restoreRefs: ReferenceRestoreResult = { restored: 0, skipped: [] };
    try {
      restoreRefs = await entry.restoreReferences(entry.referenceSnapshot);
    } catch (error) {
      this.logger.error('Undo reference restore failed', error);
    }

    if (restoreRefs.skipped.length > 0) {
      const n = restoreRefs.skipped.length;
      const list = formatSkippedList(restoreRefs.skipped);
      this.notificationService.showSuccess(
        `Restored "${name}". ${n} reference(s) couldn't be restored: ${list}.`
      );
    } else {
      this.notificationService.showSuccess(`Restored "${name}".`);
    }
  }
}
