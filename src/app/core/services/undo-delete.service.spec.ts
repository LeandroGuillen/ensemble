import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { UndoDeleteService } from './undo-delete.service';
import { ElectronService } from './electron.service';
import { NotificationService } from './notification.service';
import { LoggingService } from './logging.service';
import { UNDO_WINDOW_MS } from '../trash/trash-constants';
import {
  CharacterReferenceSnapshot,
  ReferenceRestoreResult,
} from '../interfaces/reference-snapshot.interface';

/** Must match UndoDeleteService.UNDO_ENTRY_EXPIRE_MARGIN_MS (cast for 59ad382). */
const EXPIRE_MARGIN_MS = 500;

describe('UndoDeleteService', () => {
  let service: UndoDeleteService;
  let electron: jasmine.SpyObj<ElectronService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let commitFailedHandler:
    | ((event: unknown, data: { token: string; name: string; stagedPath: string; error: string }) => void)
    | null;
  let toastSeq = 0;

  const emptySnapshot = (characterId: string): CharacterReferenceSnapshot => ({
    characterId,
    bookPovs: { characterId, removals: [] },
    casts: { characterId, removals: [] },
    houses: { characterId, removals: [] },
    pinboards: { characterId, removals: [] },
    plotThreads: { characterId, removals: [] },
  });

  beforeEach(() => {
    commitFailedHandler = null;
    toastSeq = 0;
    electron = jasmine.createSpyObj('ElectronService', [
      'restoreFromTrash',
      'onTrashCommitFailed',
    ]);
    electron.onTrashCommitFailed.and.callFake((cb: typeof commitFailedHandler) => {
      commitFailedHandler = cb;
    });
    electron.restoreFromTrash.and.returnValue(Promise.resolve({ success: true }));

    notifications = jasmine.createSpyObj('NotificationService', [
      'showUndo',
      'showSuccess',
      'showError',
      'dismiss',
      'dismissAll',
    ]);
    notifications.showUndo.and.callFake(() => `toast-${++toastSeq}`);

    TestBed.configureTestingModule({
      providers: [
        UndoDeleteService,
        { provide: ElectronService, useValue: electron },
        { provide: NotificationService, useValue: notifications },
        {
          provide: LoggingService,
          useValue: jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']),
        },
      ],
    });

    service = TestBed.inject(UndoDeleteService);
  });

  afterEach(() => {
    // Clear expiry timers left by conflict / pending tokens.
    service.dismissAll();
  });

  function register(
    token: string,
    options: {
      hasConflict?: () => boolean;
      reload?: jasmine.Spy;
      restoreReferences?: jasmine.Spy;
      name?: string;
      kind?: string;
      snapshot?: CharacterReferenceSnapshot;
      restoreResult?: ReferenceRestoreResult;
      callOrder?: string[];
      expiresAt?: number;
    } = {}
  ) {
    const callOrder = options.callOrder || [];
    const reload =
      options.reload ||
      jasmine.createSpy('reload').and.callFake(async () => {
        callOrder.push('reload');
      });
    const restoreReferences =
      options.restoreReferences ||
      jasmine.createSpy('restoreReferences').and.callFake(async () => {
        callOrder.push('restoreReferences');
        return (
          options.restoreResult || {
            restored: 0,
            skipped: [],
          }
        );
      });

    electron.restoreFromTrash.and.callFake(async () => {
      callOrder.push('restoreFromTrash');
      return { success: true };
    });

    service.register(token, {
      kind: options.kind || 'character',
      recordId: 'id1',
      name: options.name || 'Ada',
      referenceSnapshot: options.snapshot || emptySnapshot('id1'),
      ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
      hasConflict: options.hasConflict || (() => false),
      reload,
      restoreReferences,
    } as any);

    return { reload, restoreReferences, callOrder };
  }

  it('shows the Undo toast for UNDO_WINDOW_MS', () => {
    register('tok-1');
    expect(notifications.showUndo).toHaveBeenCalledWith(
      'Character "Ada" moved to Trash.',
      jasmine.any(Function),
      UNDO_WINDOW_MS
    );
  });

  it('happy path: restoreFromTrash → reload → snapshot restore, in that order', fakeAsync(() => {
    const { callOrder } = register('tok-happy');
    const onUndo = notifications.showUndo.calls.mostRecent().args[1] as () => Promise<void>;

    onUndo();
    tick();

    expect(callOrder).toEqual(['restoreFromTrash', 'reload', 'restoreReferences']);
    expect(notifications.showSuccess).toHaveBeenCalledWith('Restored "Ada".');
    expect(service.hasPending('tok-happy')).toBeFalse();
  }));

  it('conflict by id/name: no restoreFromTrash, conflict message, token left pending', fakeAsync(() => {
    register('tok-conflict', { hasConflict: () => true });
    const onUndo = notifications.showUndo.calls.mostRecent().args[1] as () => Promise<void>;

    onUndo();
    tick();

    expect(electron.restoreFromTrash).not.toHaveBeenCalled();
    expect(notifications.showError).toHaveBeenCalledWith(
      jasmine.stringMatching(/Can't undo: a character named "Ada" already exists/)
    );
    expect(service.hasPending('tok-conflict')).toBeTrue();
  }));

  it('conflict by existing path: refused restore, conflict message, token left pending', fakeAsync(() => {
    register('tok-path');
    electron.restoreFromTrash.and.returnValue(
      Promise.resolve({ success: false, error: 'Original path already exists' })
    );
    const onUndo = notifications.showUndo.calls.mostRecent().args[1] as () => Promise<void>;

    onUndo();
    tick();

    expect(notifications.showError).toHaveBeenCalledWith(
      jasmine.stringMatching(/Can't undo: a character named "Ada" already exists/)
    );
    expect(service.hasPending('tok-path')).toBeTrue();
  }));

  it('already-committed refusals drop the token without the name-conflict message', fakeAsync(() => {
    for (const error of [
      'Unknown trash token',
      'Trash entry already committed',
      'Trash entry commit already in progress',
    ]) {
      notifications.showError.calls.reset();
      const token = `tok-${error}`;
      register(token);
      electron.restoreFromTrash.and.returnValue(Promise.resolve({ success: false, error }));
      const onUndo = notifications.showUndo.calls.mostRecent().args[1] as () => Promise<void>;
      onUndo();
      tick();
      expect(service.hasPending(token)).toBeFalse();
      expect(notifications.showError).toHaveBeenCalledWith(
        jasmine.stringMatching(/already moved to the system Trash/)
      );
      expect(notifications.showError).not.toHaveBeenCalledWith(
        jasmine.stringMatching(/named "Ada" already exists/)
      );
    }
  }));

  it('shows skipped-references toast wording', fakeAsync(() => {
    register('tok-skip', {
      restoreResult: {
        restored: 2,
        skipped: [
          { kind: 'house', id: 'h1', label: 'House Stark' },
          { kind: 'pinboard', id: 'p1', label: 'Main Board' },
        ],
      },
    });
    const onUndo = notifications.showUndo.calls.mostRecent().args[1] as () => Promise<void>;

    onUndo();
    tick();

    expect(notifications.showSuccess).toHaveBeenCalledWith(
      'Restored "Ada". 2 reference(s) couldn\'t be restored: House Stark, Main Board.'
    );
  }));

  it('trash-commit-failed drops a known token and ignores unknown ones', () => {
    register('tok-fail');
    expect(commitFailedHandler).toBeTruthy();

    commitFailedHandler!({}, {
      token: 'tok-fail',
      name: 'Ada',
      stagedPath: '/proj/.ensemble-trash/entry/ada.md',
      error: 'os trash unavailable',
    });
    expect(service.hasPending('tok-fail')).toBeFalse();
    expect(notifications.dismiss).toHaveBeenCalledWith('toast-1');
    expect(notifications.showError).toHaveBeenCalledWith(
      `Couldn't move "Ada" to the system Trash (os trash unavailable). ` +
        `It's kept in /proj/.ensemble-trash/ and Ensemble will retry next time you open this project.`,
      0
    );

    notifications.showError.calls.reset();
    register('tok-other');
    commitFailedHandler!({}, {
      token: 'never-seen',
      name: 'Ghost',
      stagedPath: '/other/.ensemble-trash/e/g.md',
      error: 'boom',
    });
    // Unknown tokens still get the sticky toast (leftover commit failures).
    expect(notifications.showError).toHaveBeenCalledWith(
      jasmine.stringMatching(/Couldn't move "Ghost"/),
      0
    );
    expect(service.hasPending('tok-other')).toBeTrue();
  });

  it('dismissAll clears pending tokens and dismisses only this service\'s toasts', () => {
    register('tok-a');
    register('tok-b');
    notifications.dismiss.calls.reset();
    notifications.dismissAll.calls.reset();

    service.dismissAll();
    expect(service.hasPending('tok-a')).toBeFalse();
    expect(service.hasPending('tok-b')).toBeFalse();
    // Must not wipe unrelated app toasts.
    expect(notifications.dismissAll).not.toHaveBeenCalled();
    expect(notifications.dismiss.calls.allArgs()).toEqual([['toast-1'], ['toast-2']]);
  });

  it('expiry timer drops many pending entries after the undo window', fakeAsync(() => {
    for (let i = 0; i < 50; i++) {
      register(`tok-expire-${i}`);
    }
    const pendingCount = () =>
      typeof (service as any).pendingCount === 'function'
        ? (service as any).pendingCount()
        : Array.from({ length: 50 }, (_, i) => `tok-expire-${i}`).filter((t) =>
            service.hasPending(t)
          ).length;
    expect(pendingCount()).toBe(50);

    tick(UNDO_WINDOW_MS + EXPIRE_MARGIN_MS);
    expect(pendingCount()).toBe(0);
    for (let i = 0; i < 50; i++) {
      expect(service.hasPending(`tok-expire-${i}`)).toBeFalse();
    }
  }));
});
