import { TestBed } from '@angular/core/testing';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';
import { IpcChannels } from '../ipc/ipc-channels';

describe('ElectronService trash wrappers', () => {
  let service: ElectronService;
  let ipcRenderer: {
    invoke: jasmine.Spy;
    on: jasmine.Spy;
    removeListener: jasmine.Spy;
    send: jasmine.Spy;
  };

  beforeEach(() => {
    ipcRenderer = {
      invoke: jasmine.createSpy('invoke').and.returnValue(Promise.resolve({ success: true })),
      on: jasmine.createSpy('on'),
      removeListener: jasmine.createSpy('removeListener'),
      send: jasmine.createSpy('send'),
    };

    (window as any).require = jasmine.createSpy('require').and.returnValue({ ipcRenderer });

    TestBed.configureTestingModule({
      providers: [
        ElectronService,
        {
          provide: LoggingService,
          useValue: jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']),
        },
      ],
    });

    service = TestBed.inject(ElectronService);
  });

  afterEach(() => {
    delete (window as any).require;
  });

  it('notifies the text index only after successful file writes', async () => {
    const changed = jasmine.createSpy('changed');
    const subscription = service.filesWritten$.subscribe(changed);
    await service.writeFile('/p/notes.md', 'Notes');
    await service.writeFileAtomic('/p/book.md', 'Book notes');
    await service.rewriteWikiLinks([{ path: '/p/notes.md', expected: 'Notes', content: 'Updated' }]);
    expect(changed).toHaveBeenCalledTimes(3);
    ipcRenderer.invoke.and.resolveTo({ success: false, error: 'Read only' });
    await service.writeFile('/p/notes.md', 'Failed');
    await service.writeFileAtomic('/p/book.md', 'Failed');
    expect(changed).toHaveBeenCalledTimes(3);
    subscription.unsubscribe();
  });

  it('stageForTrash invokes trash-stage', async () => {
    const meta = { kind: 'character', recordId: 'id1', name: 'Ada' };
    ipcRenderer.invoke.and.returnValue(
      Promise.resolve({
        success: true,
        token: 'tok',
        stagedPath: '/p/.ensemble-trash/tok/ada',
        expiresAt: 1,
      })
    );

    const result = await service.stageForTrash('/p', '/p/characters/ada', meta);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IpcChannels.trashStage,
      '/p',
      '/p/characters/ada',
      meta
    );
    expect(result.success).toBeTrue();
    expect(result.token).toBe('tok');
  });

  it('restoreFromTrash invokes trash-restore', async () => {
    await service.restoreFromTrash('tok-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.trashRestore, 'tok-1');
  });

  it('commitTrash invokes trash-commit', async () => {
    await service.commitTrash('tok-2');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannels.trashCommit, 'tok-2');
  });

  it('onTrashCommitFailed listens on trash-commit-failed', () => {
    const cb = jasmine.createSpy('cb');
    service.onTrashCommitFailed(cb);
    expect(ipcRenderer.on).toHaveBeenCalledWith(IpcChannels.trashCommitFailed, cb);
  });
});
