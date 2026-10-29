import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { LocationService } from './location.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { ReferenceCleanupService } from './reference-cleanup.service';
import { UndoDeleteService } from './undo-delete.service';
import { Project } from '../interfaces/project.interface';
import { LOCATION_TYPES, LocationFormData } from '../interfaces/location.interface';

describe('LocationService', () => {
  let service: LocationService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let notificationService: jasmine.SpyObj<NotificationService>;
  let undoDeleteService: jasmine.SpyObj<UndoDeleteService>;
  let referenceCleanup: jasmine.SpyObj<ReferenceCleanupService>;

  const createValidProject = (): Project => ({
    path: '/test/project',
    metadata: {
      projectName: 'Test Project',
      version: '1.0.0',
      categories: [{ id: 'setting', name: 'Setting', color: '#FF0000' }],
      tags: [{ id: 'coastal', name: 'Coastal', color: '#0000FF' }],
      casts: [],
      books: [{ id: 'n23', name: 'Book 23', color: '#00FF00' }],
      settings: {
        defaultCategory: 'setting',
      },
    },
  });

  const createFormData = (): LocationFormData => ({
    name: 'Grey Harbor',
    books: [],
    content: 'A foggy port city.',
  });

  /** Simulated on-disk paths for collision tests (fileExists / write / move / delete). */
  let existingFiles: Set<string>;

  const installFilesystemSpies = (spy: jasmine.SpyObj<ElectronService>) => {
    existingFiles = new Set<string>();
    spy.fileExists.and.callFake(async (p: string) => existingFiles.has(p.replace(/\\/g, '/')));
    spy.writeFileAtomic.and.callFake(async (p: string) => {
      existingFiles.add(p.replace(/\\/g, '/'));
      return { success: true };
    });
    spy.moveDirectory.and.callFake(async (from: string, to: string) => {
      const src = from.replace(/\\/g, '/');
      const dest = to.replace(/\\/g, '/');
      if (src === dest) return { success: true };
      if (existingFiles.has(dest)) {
        return { success: false, error: `Destination already exists: ${to}` };
      }
      if (!existingFiles.has(src)) {
        return { success: false, error: 'Source missing' };
      }
      existingFiles.delete(src);
      existingFiles.add(dest);
      return { success: true };
    });
    spy.deleteFile.and.callFake(async (p: string) => {
      existingFiles.delete(p.replace(/\\/g, '/'));
      return { success: true };
    });
    spy.stageForTrash.and.callFake(async (_project: string, target: string) => {
      existingFiles.delete(target.replace(/\\/g, '/'));
      return { success: true, token: 'tok-loc', expiresAt: Date.now() + 15000 };
    });
  };

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'fileExists',
      'createDirectory',
      'readDirectoryRecursive',
      'readFile',
      'writeFileAtomic',
      'moveDirectory',
      'deleteFile',
      'stageForTrash',
      'getFileStats',
      'getImageAsDataUrl',
    ]);
    electronSpy.getFileStats.and.returnValue(
      Promise.resolve({
        success: true,
        stats: {
          mtime: new Date('2024-01-02T00:00:00Z'),
          ctime: new Date('2024-01-01T00:00:00Z'),
        },
      })
    );
    installFilesystemSpies(electronSpy);

    const projectSpy = jasmine.createSpyObj('ProjectService', [
      'getCurrentProject',
      'getLocationsFolderPath',
    ], {
      currentProject$: new BehaviorSubject<Project | null>(null),
    });
    projectSpy.getLocationsFolderPath.and.returnValue('/test/project/locations');

    const fileWatcherSpy = jasmine.createSpyObj('FileWatcherService', [], {
      fileChanges$: new BehaviorSubject<any>(null),
    });
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);
    const undoDeleteSpy = jasmine.createSpyObj('UndoDeleteService', ['register', 'dismissAll']);
    const cleanupSpy = jasmine.createSpyObj('ReferenceCleanupService', [
      'clearLocationReferences',
      'restoreLocationReferences',
    ]);
    cleanupSpy.clearLocationReferences.and.returnValue(
      Promise.resolve({ locationId: '', seats: [] })
    );
    cleanupSpy.restoreLocationReferences.and.returnValue(
      Promise.resolve({ restored: 0, skipped: [] })
    );

    TestBed.configureTestingModule({
      providers: [
        LocationService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: FileWatcherService, useValue: fileWatcherSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy },
        { provide: UndoDeleteService, useValue: undoDeleteSpy },
        { provide: ReferenceCleanupService, useValue: cleanupSpy },
      ],
    });

    service = TestBed.inject(LocationService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    notificationService = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
    undoDeleteService = TestBed.inject(UndoDeleteService) as jasmine.SpyObj<UndoDeleteService>;
    referenceCleanup = TestBed.inject(ReferenceCleanupService) as jasmine.SpyObj<ReferenceCleanupService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('loadLocations', () => {
    it('creates the locations directory when missing', async () => {
      electronService.fileExists.and.returnValue(Promise.resolve(false));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));

      await service.loadLocations('/test/project');

      expect(electronService.createDirectory).toHaveBeenCalledWith('/test/project/locations');
      expect(service.getLocationsSnapshot()).toEqual([]);
    });

    it('loads locations and assigns missing ids', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: '_grey-harbor.md',
              absolutePath: '/test/project/locations/_grey-harbor.md',
            },
          ],
        })
      );
      electronService.readFile.and.returnValue(
        Promise.resolve({
          success: true,
          content: `---
name: Grey Harbor
books: []
---

A foggy port.`,
        })
      );
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.loadLocations('/test/project');

      const locations = service.getLocationsSnapshot();
      expect(locations.length).toBe(1);
      expect(locations[0].name).toBe('Grey Harbor');
      expect(locations[0].id).toBeTruthy();
      expect(locations[0].type).toBeUndefined();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });
  });

  it('round-trips every location type through Markdown storage', async () => {
    projectService.getCurrentProject.and.returnValue(createValidProject());
    // Locations folder exists; individual location files tracked by installFilesystemSpies.
    electronService.fileExists.and.callFake(async (p: string) => {
      const normalized = p.replace(/\\/g, '/');
      if (normalized === '/test/project/locations') return true;
      return existingFiles.has(normalized);
    });

    for (const type of LOCATION_TYPES) {
      const created = await service.createLocation({ ...createFormData(), type: type.value });
      const markdown = electronService.writeFileAtomic.calls.mostRecent().args[1];
      electronService.readDirectoryRecursive.and.returnValue(Promise.resolve({
        success: true,
        files: [{ relativePath: created.relativePath, absolutePath: created.filePath }],
      }));
      electronService.readFile.and.returnValue(Promise.resolve({ success: true, content: markdown }));
      await service.forceReloadLocations();
      expect(service.getLocationById(created.id)?.type).toBe(type.value);
    }
  });

  it('preserves type on unrelated edits and allows clearing it', async () => {
    projectService.getCurrentProject.and.returnValue(createValidProject());
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    const created = await service.createLocation({ ...createFormData(), type: 'settlement' });
    expect((await service.updateLocation(created.id, { content: 'Updated description' }))?.type)
      .toBe('settlement');
    expect((await service.updateLocation(created.id, { type: 'district' }))?.type).toBe('district');
    expect((await service.updateLocation(created.id, { type: undefined }))?.type).toBeUndefined();
    expect(electronService.writeFileAtomic.calls.mostRecent().args[1]).not.toContain('type:');
  });

  describe('createLocation', () => {
    it('creates a location file and updates the list', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const created = await service.createLocation(createFormData());

      expect(created.name).toBe('Grey Harbor');
      expect(created.relativePath).toBe('_grey-harbor.md');
      expect(created.filePath).toBe('/test/project/locations/_grey-harbor.md');
      expect(service.getLocationsSnapshot().length).toBe(1);
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('uses an ASCII-only filename for an accented location name', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const created = await service.createLocation({
        ...createFormData(),
        name: 'Alcázar de Sotero',
      });

      expect(created.relativePath).toBe('_alcazar-de-sotero.md');
    });

    it('rejects unknown book ids', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      await expectAsync(
        service.createLocation({
          ...createFormData(),
          books: ['missing-book'],
        })
      ).toBeRejected();
    });

    it('picks a free filename when the slug file already exists', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      const first = await service.createLocation({ ...createFormData(), name: 'The Castle' });
      const second = await service.createLocation({ ...createFormData(), name: 'the castle!' });

      expect(first.relativePath).toBe('_the-castle.md');
      expect(second.relativePath).toMatch(/^_the-castle-[a-z0-9]+\.md$/);
      expect(second.filePath).not.toBe(first.filePath);
      expect(service.getLocationsSnapshot().length).toBe(2);
    });

    it('picks a free filename for accent-only name differences', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      const first = await service.createLocation({ ...createFormData(), name: 'Café Real' });
      const second = await service.createLocation({ ...createFormData(), name: 'Cafe Real' });

      expect(first.relativePath).toBe('_cafe-real.md');
      expect(second.relativePath).toMatch(/^_cafe-real-[a-z0-9]+\.md$/);
      expect(second.filePath).not.toBe(first.filePath);
    });

    it('keeps two non-ASCII names on distinct files', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      const tokyo = await service.createLocation({ ...createFormData(), name: '東京' });
      const moscow = await service.createLocation({ ...createFormData(), name: 'Москва' });

      expect(tokyo.relativePath).toBe('_location.md');
      expect(moscow.relativePath).toMatch(/^_location-[a-z0-9]+\.md$/);
      expect(tokyo.filePath).not.toBe(moscow.filePath);
      expect(service.getLocationsSnapshot().length).toBe(2);
    });
  });

  describe('updateLocation', () => {
    it('renames the file when the name changes', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);

      const created = await service.createLocation(createFormData());
      const updated = await service.updateLocation(created.id, { name: 'Black Harbor' });

      expect(updated?.name).toBe('Black Harbor');
      expect(updated?.relativePath).toBe('_black-harbor.md');
      expect(electronService.moveDirectory).toHaveBeenCalled();
    });

    it('picks a free filename when renaming onto an existing slug', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      const harbor = await service.createLocation({ ...createFormData(), name: 'Grey Harbor' });
      const castle = await service.createLocation({ ...createFormData(), name: 'The Castle' });

      const renamed = await service.updateLocation(castle.id, { name: 'Grey Harbor!' });

      expect(harbor.relativePath).toBe('_grey-harbor.md');
      expect(renamed?.relativePath).toMatch(/^_grey-harbor-[a-z0-9]+\.md$/);
      expect(renamed?.filePath).not.toBe(harbor.filePath);

      const snapshot = service.getLocationsSnapshot();
      expect(snapshot.find((l) => l.id === harbor.id)?.filePath).toBe(harbor.filePath);
      expect(snapshot.find((l) => l.id === castle.id)?.filePath).toBe(renamed?.filePath);
      expect(new Set(snapshot.map((l) => l.filePath)).size).toBe(2);
    });

    it('keeps the same file on a case-only rename', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      const created = await service.createLocation({ ...createFormData(), name: 'castle a' });
      electronService.moveDirectory.calls.reset();

      const updated = await service.updateLocation(created.id, { name: 'Castle A' });

      expect(updated?.name).toBe('Castle A');
      expect(updated?.relativePath).toBe('_castle-a.md');
      expect(updated?.filePath).toBe(created.filePath);
      expect(electronService.moveDirectory).not.toHaveBeenCalled();
    });
  });

  describe('deleteLocation with distinct collision files', () => {
    it('deleting one colliding location does not stage the other file', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      const first = await service.createLocation({ ...createFormData(), name: 'The Castle' });
      const second = await service.createLocation({ ...createFormData(), name: 'the castle!' });

      expect(first.filePath).not.toBe(second.filePath);

      await service.deleteLocation(first.id);

      expect(electronService.stageForTrash).toHaveBeenCalledWith(
        '/test/project',
        first.filePath,
        jasmine.objectContaining({ kind: 'location' })
      );
      expect(electronService.deleteFile).not.toHaveBeenCalled();
      expect(existingFiles.has(second.filePath)).toBeTrue();
      expect(existingFiles.has(first.filePath)).toBeFalse();
      expect(service.getLocationById(second.id)?.filePath).toBe(second.filePath);
    });
  });

  describe('deleteLocation', () => {
    it('stages the file, removes from the list, and registers Undo', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);

      const created = await service.createLocation(createFormData());
      const deleted = await service.deleteLocation(created.id);

      expect(deleted).toBeTrue();
      expect(service.getLocationsSnapshot()).toEqual([]);
      expect(electronService.stageForTrash).toHaveBeenCalledWith(
        '/test/project',
        created.filePath,
        jasmine.objectContaining({ kind: 'location', name: created.name })
      );
      expect(electronService.deleteFile).not.toHaveBeenCalled();
      expect(undoDeleteService.register).toHaveBeenCalled();
    });

    it('calls house seatId cleanup when deleting a location', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);

      const created = await service.createLocation(createFormData());
      await service.deleteLocation(created.id);

      expect(referenceCleanup.clearLocationReferences).toHaveBeenCalledWith(created.id);
    });

    it('still succeeds when house cleanup throws an error', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);

      const created = await service.createLocation(createFormData());
      referenceCleanup.clearLocationReferences.and.returnValue(
        Promise.reject(new Error('Cleanup failed'))
      );

      const deleted = await service.deleteLocation(created.id);

      expect(deleted).toBeTrue();
      expect(service.getLocationsSnapshot()).toEqual([]);
      expect(electronService.stageForTrash).toHaveBeenCalled();
      expect(electronService.deleteFile).not.toHaveBeenCalled();
    });

    it('on staging failure leaves lists unchanged and toasts Nothing was changed', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      const created = await service.createLocation(createFormData());
      electronService.stageForTrash.and.returnValue(
        Promise.resolve({ success: false, error: 'busy' })
      );

      await expectAsync(service.deleteLocation(created.id)).toBeRejected();
      expect(service.getLocationById(created.id)).toBeTruthy();
      expect(existingFiles.has(created.filePath)).toBeTrue();
      expect(notificationService.showError).toHaveBeenCalledWith(
        `Couldn't delete "${created.name}": busy. Nothing was changed.`
      );
      expect(undoDeleteService.register).not.toHaveBeenCalled();
    });

    it('sanitizes recordIds with a dot or accent for staging', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      const created = await service.createLocation(createFormData());
      (created as any).id = 'loc.harbour';
      (service as any).locationsSubject.next([created]);

      await service.deleteLocation('loc.harbour');
      expect(electronService.stageForTrash).toHaveBeenCalledWith(
        '/test/project',
        created.filePath,
        jasmine.objectContaining({ recordId: 'loc_harbour' })
      );
      expect(undoDeleteService.register).toHaveBeenCalledWith(
        'tok-loc',
        jasmine.objectContaining({ recordId: 'loc.harbour' })
      );
    });
  });
});
