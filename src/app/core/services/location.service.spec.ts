import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { LocationService } from './location.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { Project } from '../interfaces/project.interface';
import { LocationFormData } from '../interfaces/location.interface';

describe('LocationService', () => {
  let service: LocationService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;

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

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'fileExists',
      'createDirectory',
      'readDirectoryRecursive',
      'readFile',
      'writeFileAtomic',
      'moveDirectory',
      'deleteFile',
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

    TestBed.configureTestingModule({
      providers: [
        LocationService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: FileWatcherService, useValue: fileWatcherSpy },
        { provide: LoggingService, useValue: loggingSpy },
      ],
    });

    service = TestBed.inject(LocationService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
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
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });
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

    it('rejects unknown book ids', async () => {
      projectService.getCurrentProject.and.returnValue(createValidProject());

      await expectAsync(
        service.createLocation({
          ...createFormData(),
          books: ['missing-book'],
        })
      ).toBeRejected();
    });
  });

  describe('updateLocation', () => {
    it('renames the file when the name changes', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.moveDirectory.and.returnValue(Promise.resolve({ success: true }));

      const created = await service.createLocation(createFormData());
      const updated = await service.updateLocation(created.id, { name: 'Black Harbor' });

      expect(updated?.name).toBe('Black Harbor');
      expect(updated?.relativePath).toBe('_black-harbor.md');
      expect(electronService.moveDirectory).toHaveBeenCalled();
    });
  });

  describe('deleteLocation', () => {
    it('deletes the file and removes from the list', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.deleteFile.and.returnValue(Promise.resolve({ success: true }));

      const created = await service.createLocation(createFormData());
      const deleted = await service.deleteLocation(created.id);

      expect(deleted).toBeTrue();
      expect(service.getLocationsSnapshot()).toEqual([]);
      expect(electronService.deleteFile).toHaveBeenCalledWith(created.filePath);
    });
  });
});
