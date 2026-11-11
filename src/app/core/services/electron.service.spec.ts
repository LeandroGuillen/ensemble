import { TestBed } from '@angular/core/testing';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';
import { ProjectWriteProtectionService } from './project-write-protection.service';
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

  it('blocks edits throughout a read-only project, allows browsing and copying out, and protects sibling paths correctly', async () => {
    const protection = TestBed.inject(ProjectWriteProtectionService);
    protection.readOnlyPath = '/archive';
    const attempts = [
      service.writeFile('/archive/notes.md', 'changed'),
      service.writeFileAtomic('/archive/ensemble.json', '{}'),
      service.createDirectory('/archive/new'),
      service.deleteFile('/archive/notes.md'),
      service.moveFile('/archive/notes.md', '/elsewhere/notes.md'),
      service.moveDirectory('/archive/characters', '/elsewhere/characters'),
      service.copyFile('/elsewhere/image.jpg', '/archive/image.jpg'),
      service.copyDirectoryRecursive('/elsewhere', '/archive/new'),
      service.stageForTrash('/archive', '/archive/characters/ada', { kind: 'character', recordId: 'ada', name: 'Ada' }),
      service.downloadImage('https://example.com/image.jpg', '/archive/image.jpg'),
      service.saveBase64Image('data', '/archive/image.jpg'),
      service.rewriteWikiLinks([{ path: '/archive/notes.md', expected: '', content: 'new' }]),
      service.deleteDirectoryRecursive('/archive/new'),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.success).toBeFalse();
      expect(result.error).toContain('read-only');
    }
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    await service.readFile('/archive/notes.md');
    await service.copyDirectoryRecursive('/archive', '/writable-copy');
    await service.writeFileAtomic('/archive-copy/notes.md', 'allowed');
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(3);
    protection.readOnlyPath = null;
    await service.writeFileAtomic('/archive/notes.md', 'allowed again');
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(4);
  });

  it('notifies the text index only after successful file writes', async () => {
    const changed = jasmine.createSpy('changed');
    const subscription = service.filesWritten$.subscribe(changed);
    await service.writeFile('/p/notes.md', 'Notes');
    await service.writeFileAtomic('/p/book.md', 'Book notes');
    await service.rewriteWikiLinks([{ path: '/p/notes.md', expected: 'Notes', content: 'Updated' }]);
    expect(changed.calls.allArgs()).toEqual([['/p/notes.md'], ['/p/book.md'], ['/p/notes.md']]);
    ipcRenderer.invoke.and.resolveTo({ success: false, error: 'Read only' });
    await service.writeFile('/p/notes.md', 'Failed');
    await service.writeFileAtomic('/p/book.md', 'Failed');
    expect(changed.calls.allArgs()).toEqual([['/p/notes.md'], ['/p/book.md'], ['/p/notes.md']]);
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
