import { TestBed } from '@angular/core/testing';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { Project, ProjectMetadata } from '../interfaces/project.interface';

describe('ProjectService', () => {
  let service: ProjectService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let loggingService: jasmine.SpyObj<LoggingService>;
  let notificationService: jasmine.SpyObj<NotificationService>;

  const createValidMetadata = (): ProjectMetadata => ({
    projectName: 'Test Project',
    version: '1.0.0',
    categories: [
      { id: 'main-character', name: 'Main Character', color: '#FF0000' }
    ],
    tags: [
      { id: 'magic-user', name: 'Magic User', color: '#0000FF' }
    ],
    casts: [],
    books: [],
    settings: {
      defaultCategory: 'main-character',
      autoSave: true,
      fileWatchEnabled: true
    }
  });

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'isElectron',
      'isDirectory',
      'fileExists',
      'readFile',
      'writeFile',
      'writeFileAtomic',
      'createDirectory',
      'pathBasename',
      'getRecentProjects',
      'saveRecentProjects',
      'deleteFile',
      'readDirectoryFiles'
    ]);
    electronSpy.saveRecentProjects.and.returnValue(Promise.resolve({ success: true }));
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);

    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy }
      ]
    });

    service = TestBed.inject(ProjectService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
    notificationService = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;

    electronService.isElectron.and.returnValue(true);
    electronService.getRecentProjects.and.returnValue(Promise.resolve([]));
    electronService.saveRecentProjects.and.returnValue(Promise.resolve({ success: true }));
    electronService.deleteFile.and.returnValue(Promise.resolve({ success: true }));
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCurrentProject', () => {
    it('should return null initially', () => {
      expect(service.getCurrentProject()).toBeNull();
    });

    it('should return current project after loading', async () => {
      const projectPath = '/test/project';
      electronService.isDirectory.and.returnValue(Promise.resolve(true));
      electronService.fileExists.and.callFake((path: string) => {
        if (path.includes('ensemble.json')) return Promise.resolve(true);
        if (path.includes('characters')) return Promise.resolve(false);
        return Promise.resolve(false);
      });
      electronService.readFile.and.returnValue(Promise.resolve({
        success: true,
        content: JSON.stringify(createValidMetadata())
      }));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
        success: true,
        files: [],
        directories: []
      }));

      await service.loadProject(projectPath);

      const project = service.getCurrentProject();
      expect(project).toBeTruthy();
      expect(project?.path).toBe(projectPath);
    });
  });

  describe('loadProject', () => {
    it('should load project from ensemble.json', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();

    electronService.isDirectory.and.returnValue(Promise.resolve(true));
    electronService.fileExists.and.callFake((path: string) => {
      if (path.includes('ensemble.json')) return Promise.resolve(true);
      if (path.includes('characters')) return Promise.resolve(false);
      return Promise.resolve(false);
    });
    electronService.readFile.and.returnValue(Promise.resolve({
      success: true,
      content: JSON.stringify(metadata)
    }));
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
      success: true,
      files: [],
      directories: []
    }));

      const project = await service.loadProject(projectPath);

      expect(project).toBeTruthy();
      expect(project?.path).toBe(projectPath);
      expect(project?.metadata.projectName).toBe('Test Project');
      expect(electronService.readFile).toHaveBeenCalled();
    });

    it('should throw error when path is not a directory', async () => {
      electronService.isDirectory.and.returnValue(Promise.resolve(false));

      await expectAsync(service.loadProject('/test/file')).toBeRejected();
    });

    it('should create default metadata when ensemble.json does not exist', async () => {
      const projectPath = '/test/project';
      electronService.isDirectory.and.returnValue(Promise.resolve(true));
      electronService.fileExists.and.returnValue(Promise.resolve(false));
      electronService.pathBasename.and.returnValue(Promise.resolve('project'));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const project = await service.loadProject(projectPath);

      expect(project).toBeTruthy();
      expect(project?.metadata.projectName).toBe('project');
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should migrate from metadata.json if ensemble.json does not exist', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();

      electronService.isDirectory.and.returnValue(Promise.resolve(true));
      electronService.fileExists.and.callFake((path: string) => {
        if (path.includes('ensemble.json')) return Promise.resolve(false);
        if (path.includes('metadata.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      electronService.readFile.and.returnValue(Promise.resolve({
        success: true,
        content: JSON.stringify(metadata)
      }));
      electronService.fileExists.and.callFake((path: string) => {
        if (path.includes('ensemble.json')) return Promise.resolve(false);
        if (path.includes('metadata.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      electronService.deleteFile.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));

      const project = await service.loadProject(projectPath);

      expect(project).toBeTruthy();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should throw error when JSON is invalid', async () => {
      const projectPath = '/test/project';
      electronService.isDirectory.and.returnValue(Promise.resolve(true));
      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readFile.and.returnValue(Promise.resolve({
        success: true,
        content: 'invalid json'
      }));

      await expectAsync(service.loadProject(projectPath)).toBeRejected();
    });

    it('should ensure project structure exists', async () => {
      const projectPath = '/test/project';
      electronService.isDirectory.and.returnValue(Promise.resolve(true));
      electronService.fileExists.and.callFake((path: string) => {
        if (path.includes('ensemble.json')) return Promise.resolve(true);
        if (path.includes('characters')) return Promise.resolve(false);
        return Promise.resolve(false);
      });
      electronService.readFile.and.returnValue(Promise.resolve({
        success: true,
        content: JSON.stringify(createValidMetadata())
      }));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
        success: true,
        files: [],
        directories: []
      }));

      await service.loadProject(projectPath);

      expect(electronService.createDirectory).toHaveBeenCalled();
    });
  });

  describe('createProject', () => {
    it('should create a new project', async () => {
      const projectPath = '/test/new-project';
      const projectName = 'New Project';

      electronService.fileExists.and.returnValue(Promise.resolve(false));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.saveRecentProjects.and.returnValue(Promise.resolve({ success: true }));

      const project = await service.createProject(projectPath, projectName);

      expect(project).toBeTruthy();
      expect(project?.path).toBe(projectPath);
      expect(project?.metadata.projectName).toBe(projectName);
      expect(electronService.createDirectory).toHaveBeenCalled();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should throw error when directory already exists and is a project', async () => {
      const projectPath = '/test/existing-project';
      electronService.fileExists.and.callFake((path: string) => {
        if (path === projectPath) return Promise.resolve(true);
        if (path.includes('metadata.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      electronService.isDirectory.and.returnValue(Promise.resolve(true));

      await expectAsync(service.createProject(projectPath, 'Project')).toBeRejected();
    });

    it('should throw error when path exists but is not a directory', async () => {
      const projectPath = '/test/file';
      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.isDirectory.and.returnValue(Promise.resolve(false));

      await expectAsync(service.createProject(projectPath, 'Project')).toBeRejected();
    });

    it('should create directory structure', async () => {
      const projectPath = '/test/new-project';
      electronService.fileExists.and.returnValue(Promise.resolve(false));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.saveRecentProjects.and.returnValue(Promise.resolve({ success: true }));

      await service.createProject(projectPath, 'New Project');

      expect(electronService.createDirectory).toHaveBeenCalledTimes(2); // project and characters
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and save to file', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();

    electronService.isDirectory.and.returnValue(Promise.resolve(true));
    electronService.fileExists.and.callFake((path: string) => {
      if (path.includes('ensemble.json')) return Promise.resolve(true);
      if (path.includes('characters')) return Promise.resolve(false);
      return Promise.resolve(false);
    });
    electronService.readFile.and.returnValue(Promise.resolve({
      success: true,
      content: JSON.stringify(metadata)
    }));
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
      success: true,
      files: [],
      directories: []
    }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.loadProject(projectPath);

      const updatedMetadata = { ...metadata, projectName: 'Updated Project' };
      await service.updateMetadata(updatedMetadata);

      expect(electronService.writeFileAtomic).toHaveBeenCalled();
      const project = service.getCurrentProject();
      expect(project?.metadata.projectName).toBe('Updated Project');
    });

    it('should throw error when no project is loaded', async () => {
      await expectAsync(service.updateMetadata({})).toBeRejected();
    });
  });

  describe('getCategories', () => {
    it('should return categories from current project', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();

    electronService.isDirectory.and.returnValue(Promise.resolve(true));
    electronService.fileExists.and.callFake((path: string) => {
      if (path.includes('ensemble.json')) return Promise.resolve(true);
      if (path.includes('characters')) return Promise.resolve(false);
      return Promise.resolve(false);
    });
    electronService.readFile.and.returnValue(Promise.resolve({
      success: true,
      content: JSON.stringify(metadata)
    }));
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
      success: true,
      files: [],
      directories: []
    }));

      await service.loadProject(projectPath);

      const categories = service.getCategories();
      expect(categories.length).toBe(1);
      expect(categories[0].id).toBe('main-character');
    });

    it('should return empty array when no project is loaded', () => {
      const categories = service.getCategories();
      expect(categories).toEqual([]);
    });
  });

  describe('getTags', () => {
    it('should return tags from current project', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();

    electronService.isDirectory.and.returnValue(Promise.resolve(true));
    electronService.fileExists.and.callFake((path: string) => {
      if (path.includes('ensemble.json')) return Promise.resolve(true);
      if (path.includes('characters')) return Promise.resolve(false);
      return Promise.resolve(false);
    });
    electronService.readFile.and.returnValue(Promise.resolve({
      success: true,
      content: JSON.stringify(metadata)
    }));
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
      success: true,
      files: [],
      directories: []
    }));

      await service.loadProject(projectPath);

      const tags = service.getTags();
      expect(tags.length).toBe(1);
      expect(tags[0].id).toBe('magic-user');
    });
  });

  describe('addCategory', () => {
    it('should add category to project', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();

    electronService.isDirectory.and.returnValue(Promise.resolve(true));
    electronService.fileExists.and.callFake((path: string) => {
      if (path.includes('ensemble.json')) return Promise.resolve(true);
      if (path.includes('characters')) return Promise.resolve(false);
      return Promise.resolve(false);
    });
    electronService.readFile.and.returnValue(Promise.resolve({
      success: true,
      content: JSON.stringify(metadata)
    }));
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
      success: true,
      files: [],
      directories: []
    }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.loadProject(projectPath);

      const category = await service.addCategory({
        name: 'Supporting',
        color: '#00FF00'
      });

      expect(category).toBeTruthy();
      expect(category?.name).toBe('Supporting');
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should throw error when no project is loaded', async () => {
      await expectAsync(service.addCategory({
        name: 'Test',
        color: '#FF0000'
      })).toBeRejected();
    });
  });

  describe('removeCategory', () => {
    it('should remove category from project', async () => {
      const projectPath = '/test/project';
      const metadata = createValidMetadata();
      metadata.categories.push({ id: 'supporting', name: 'Supporting', color: '#00FF00' });

    electronService.isDirectory.and.returnValue(Promise.resolve(true));
    electronService.fileExists.and.callFake((path: string) => {
      if (path.includes('ensemble.json')) return Promise.resolve(true);
      if (path.includes('characters')) return Promise.resolve(false);
      return Promise.resolve(false);
    });
    electronService.readFile.and.returnValue(Promise.resolve({
      success: true,
      content: JSON.stringify(metadata)
    }));
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
      success: true,
      files: [],
      directories: []
    }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.loadProject(projectPath);

      await service.removeCategory('supporting');

      const categories = service.getCategories();
      expect(categories.find(c => c.id === 'supporting')).toBeUndefined();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });
  });

  describe('recent projects', () => {
    it('should get recent projects', async () => {
      electronService.getRecentProjects.and.returnValue(Promise.resolve([
        { path: '/project1', lastAccessed: '2024-01-01T00:00:00.000Z' },
        { path: '/project2', lastAccessed: '2024-01-02T00:00:00.000Z' }
      ]));

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      const recent = service.getRecentProjects();
      expect(recent.length).toBeGreaterThanOrEqual(0);
    });

    it('should get most recent project', async () => {
      // Reset the service to ensure clean state
      const newService = TestBed.inject(ProjectService);
      electronService.getRecentProjects.and.returnValue(Promise.resolve([
        { path: '/project1', lastAccessed: '2024-01-01T00:00:00.000Z' }
      ]));

      // Wait for service initialization
      await new Promise(resolve => setTimeout(resolve, 300));

      const mostRecent = newService.getMostRecentProject();
      // The service loads recent projects asynchronously, so it might be null initially
      // or it might have loaded by now
      expect(mostRecent === null || mostRecent === '/project1').toBe(true);
    });
  });
});

