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

describe('UndoDeleteService', () => {
  let service: UndoDeleteService;
  let electron: jasmine.SpyObj<ElectronService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let commitFailedHandler:
    | ((event: unknown, data: { token: string; name: string; stagedPath: string; error: string }) => void)
    | null;

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
    notifications.showUndo.and.returnValue('toast-1');

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
      hasConflict: options.hasConflict || (() => false),
      reload,
      restoreReferences,
    });

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
      stagedPath: '/x',
      error: 'os trash unavailable',
    });
    expect(service.hasPending('tok-fail')).toBeFalse();
    expect(notifications.dismiss).toHaveBeenCalledWith('toast-1');

    register('tok-other');
    commitFailedHandler!({}, {
      token: 'never-seen',
      name: 'Ghost',
      stagedPath: '/y',
      error: 'boom',
    });
    expect(service.hasPending('tok-other')).toBeTrue();
  });

  it('dismissAll clears pending tokens and dismisses toasts', () => {
    register('tok-a');
    register('tok-b');
    service.dismissAll();
    expect(service.hasPending('tok-a')).toBeFalse();
    expect(service.hasPending('tok-b')).toBeFalse();
    expect(notifications.dismissAll).toHaveBeenCalled();
  });
});
