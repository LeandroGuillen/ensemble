import { TestBed } from '@angular/core/testing';
import { FileWatcherService, FileChangeEvent } from './file-watcher.service';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let loggingService: jasmine.SpyObj<LoggingService>;
  let notificationService: jasmine.SpyObj<NotificationService>;

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'isElectron',
      'startFileWatcher',
      'stopFileWatcher',
      'onFileChanged',
      'removeFileChangedListener'
    ]);
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);

    TestBed.configureTestingModule({
      providers: [
        FileWatcherService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy }
      ]
    });

    service = TestBed.inject(FileWatcherService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
    notificationService = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;

    electronService.isElectron.and.returnValue(true);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startWatching', () => {
    it('should start watching a project path', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      await service.startWatching('/test/project');

      expect(electronService.startFileWatcher).toHaveBeenCalledWith('/test/project');
      expect(electronService.onFileChanged).toHaveBeenCalled();
      expect(service.isCurrentlyWatching()).toBe(true);
    });

    it('should stop existing watcher before starting a new one', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));
      electronService.stopFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      await service.startWatching('/test/project1');
      await service.startWatching('/test/project2');

      expect(electronService.stopFileWatcher).toHaveBeenCalled();
      expect(electronService.startFileWatcher).toHaveBeenCalledTimes(2);
    });

    it('should throw error when file watcher fails to start', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: false, error: 'Failed to start' }));

      await expectAsync(service.startWatching('/test/project')).toBeRejected();
      expect(service.isCurrentlyWatching()).toBe(false);
    });

    it('should log errors when file watcher fails', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: false, error: 'Failed to start' }));

      try {
        await service.startWatching('/test/project');
      } catch (e) {
        // Expected to throw
      }

      expect(loggingService.error).toHaveBeenCalled();
    });
  });

  describe('stopWatching', () => {
    it('should stop watching when currently watching', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));
      electronService.stopFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      await service.startWatching('/test/project');
      await service.stopWatching();

      expect(electronService.stopFileWatcher).toHaveBeenCalled();
      expect(electronService.removeFileChangedListener).toHaveBeenCalled();
      expect(service.isCurrentlyWatching()).toBe(false);
    });

    it('should do nothing when not watching', async () => {
      await service.stopWatching();

      expect(electronService.stopFileWatcher).not.toHaveBeenCalled();
      expect(service.isCurrentlyWatching()).toBe(false);
    });

    it('should handle errors when stopping watcher', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));
      electronService.stopFileWatcher.and.returnValue(Promise.reject(new Error('Stop failed')));

      await service.startWatching('/test/project');
      await service.stopWatching();

      expect(loggingService.error).toHaveBeenCalled();
      expect(service.isCurrentlyWatching()).toBe(false);
    });
  });

  describe('isCurrentlyWatching', () => {
    it('should return false initially', () => {
      expect(service.isCurrentlyWatching()).toBe(false);
    });

    it('should return true after starting', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      await service.startWatching('/test/project');

      expect(service.isCurrentlyWatching()).toBe(true);
    });

    it('should return false after stopping', async () => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));
      electronService.stopFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      await service.startWatching('/test/project');
      await service.stopWatching();

      expect(service.isCurrentlyWatching()).toBe(false);
    });
  });

  describe('fileChanges$', () => {
    it('should emit file change events for relevant files', (done) => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      let callback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;
      electronService.onFileChanged.and.callFake((cb) => {
        callback = cb;
      });

      service.fileChanges$.subscribe((event: FileChangeEvent) => {
        expect(event.type).toBe('change');
        expect(event.path).toBe('/test/project/character.md');
        expect(event.filename).toBe('character.md');
        done();
      });

      service.startWatching('/test/project').then(() => {
        if (callback) {
          callback({}, { type: 'change', path: '/test/project/character.md', filename: 'character.md' });
        }
      });
    });

    it('should emit events for markdown files', (done) => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      let callback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;
      electronService.onFileChanged.and.callFake((cb) => {
        callback = cb;
      });

      service.fileChanges$.subscribe((event: FileChangeEvent) => {
        expect(event.filename).toBe('test.md');
        done();
      });

      service.startWatching('/test/project').then(() => {
        if (callback) {
          callback({}, { type: 'add', path: '/test/project/test.md', filename: 'test.md' });
        }
      });
    });

    it('should emit events for ensemble.json', (done) => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      let callback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;
      electronService.onFileChanged.and.callFake((cb) => {
        callback = cb;
      });

      service.fileChanges$.subscribe((event: FileChangeEvent) => {
        expect(event.filename).toBe('ensemble.json');
        done();
      });

      service.startWatching('/test/project').then(() => {
        if (callback) {
          callback({}, { type: 'change', path: '/test/project/ensemble.json', filename: 'ensemble.json' });
        }
      });
    });

    it('should emit events for image files', (done) => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      let callback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;
      electronService.onFileChanged.and.callFake((cb) => {
        callback = cb;
      });

      service.fileChanges$.subscribe((event: FileChangeEvent) => {
        expect(event.filename).toBe('image.png');
        done();
      });

      service.startWatching('/test/project').then(() => {
        if (callback) {
          callback({}, { type: 'add', path: '/test/project/image.png', filename: 'image.png' });
        }
      });
    });

    it('should not emit events for irrelevant files', (done) => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      let callback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;
      electronService.onFileChanged.and.callFake((cb) => {
        callback = cb;
      });

      let eventEmitted = false;
      service.fileChanges$.subscribe(() => {
        eventEmitted = true;
      });

      service.startWatching('/test/project').then(() => {
        if (callback) {
          callback({}, { type: 'change', path: '/test/project/irrelevant.txt', filename: 'irrelevant.txt' });
        }
        setTimeout(() => {
          expect(eventEmitted).toBe(false);
          done();
        }, 100);
      });
    });

    it('should handle unlink events', (done) => {
      electronService.startFileWatcher.and.returnValue(Promise.resolve({ success: true }));

      let callback: ((event: any, data: { type: string; path: string; filename: string }) => void) | null = null;
      electronService.onFileChanged.and.callFake((cb) => {
        callback = cb;
      });

      service.fileChanges$.subscribe((event: FileChangeEvent) => {
        expect(event.type).toBe('unlink');
        expect(event.filename).toBe('deleted.md');
        done();
      });

      service.startWatching('/test/project').then(() => {
        if (callback) {
          callback({}, { type: 'unlink', path: '/test/project/deleted.md', filename: 'deleted.md' });
        }
      });
    });
  });
});

