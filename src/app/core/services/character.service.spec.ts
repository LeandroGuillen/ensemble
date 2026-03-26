import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { CharacterService } from './character.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { Project, ProjectMetadata } from '../interfaces/project.interface';
import { Character, CharacterFormData } from '../interfaces/character.interface';

describe('CharacterService', () => {
  let service: CharacterService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let fileWatcherService: jasmine.SpyObj<FileWatcherService>;
  let loggingService: jasmine.SpyObj<LoggingService>;
  let notificationService: jasmine.SpyObj<NotificationService>;

  const createValidProject = (): Project => ({
    path: '/test/project',
    metadata: {
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
    }
  });

  const createValidCharacterFormData = (): CharacterFormData => ({
    name: 'Test Character',
    category: 'main-character',
    tags: ['magic-user'],
    books: [],
    content: 'Test content'
  });

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'isElectron',
      'fileExists',
      'createDirectory',
      'readDirectoryFiles',
      'readDirectoryRecursive',
      'readFile',
      'writeFileAtomic',
      'moveDirectory',
      'copyFile',
      'deleteFile',
      'deleteDirectoryRecursive'
    ]);
    const projectSpy = jasmine.createSpyObj('ProjectService', ['getCurrentProject', 'getCharactersFolderPath'], {
      currentProject$: new BehaviorSubject<Project | null>(null)
    });
    const fileWatcherSpy = jasmine.createSpyObj('FileWatcherService', [], {
      fileChanges$: new BehaviorSubject<any>(null)
    });
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);

    TestBed.configureTestingModule({
      providers: [
        CharacterService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: FileWatcherService, useValue: fileWatcherSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy }
      ]
    });

    service = TestBed.inject(CharacterService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    fileWatcherService = TestBed.inject(FileWatcherService) as jasmine.SpyObj<FileWatcherService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
    notificationService = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;

    electronService.isElectron.and.returnValue(true);
    projectService.getCharactersFolderPath.and.returnValue('/test/project/characters');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCharacters', () => {
    it('should return observable of characters', (done) => {
      service.getCharacters().subscribe(characters => {
        expect(Array.isArray(characters)).toBe(true);
        done();
      });
    });
  });

  describe('getCharacterById', () => {
    it('should return character by id', () => {
      const character: Character = {
        id: '_char-1.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/path/to/char/_char-1.md',
      };

      (service as any).charactersSubject.next([character]);

      const found = service.getCharacterById('_char-1.md');
      expect(found).toBeTruthy();
      expect(found?.name).toBe('Test Character');
    });

    it('should return undefined for non-existent character', () => {
      (service as any).charactersSubject.next([]);
      const found = service.getCharacterById('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('createCharacter', () => {
    it('should create a new character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const formData = createValidCharacterFormData();
      const character = await service.createCharacter(formData);

      expect(character).toBeTruthy();
      expect(character.name).toBe('Test Character');
      expect(character.category).toBe('main-character');
      expect(electronService.createDirectory).not.toHaveBeenCalled();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should throw error when no project is loaded', async () => {
      projectService.getCurrentProject.and.returnValue(null);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);

      const formData = createValidCharacterFormData();
      await expectAsync(service.createCharacter(formData)).toBeRejected();
    });

    it('should create character file in flat mode', async () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'flat';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const formData = createValidCharacterFormData();
      await service.createCharacter(formData);

      // Characters are always stored directly under characters/, regardless of folder mode.
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
      expect(electronService.createDirectory).not.toHaveBeenCalled();
    });

    it('should not create category folders even when folder mode is auto', async () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'auto';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const formData = createValidCharacterFormData();
      await service.createCharacter(formData);

      // Category storage location is decoupled from category.
      expect(electronService.createDirectory).not.toHaveBeenCalled();
    });
  });

  describe('updateCharacter', () => {
    it('should update an existing character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: 'main-character/_original-name.md',
        name: 'Original Name',
        category: 'main-character',
        tags: [],
        books: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/test/project/characters/main-character/_original-name.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('main-character/_original-name.md', {
        content: 'Updated content'
      });

      expect(updated).toBeTruthy();
      expect(updated?.name).toBe('Original Name');
      expect(updated?.content).toBe('Updated content');
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should return null when character does not exist', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      (service as any).charactersSubject.next([]);

      const updated = await service.updateCharacter('non-existent', {
        name: 'Updated'
      });

      expect(updated).toBeNull();
    });

    it('should not move character file when category changes', async () => {
      const project = createValidProject();
      project.metadata.categories.push({ id: 'supporting', name: 'Supporting', color: '#00FF00' });
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: 'main-character/_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/test/project/characters/main-character/_test-character.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('main-character/_test-character.md', {
        category: 'supporting'
      });

      expect(updated).toBeTruthy();
      expect(updated?.category).toBe('supporting');
      expect(electronService.moveDirectory).not.toHaveBeenCalled();
    });
  });

  describe('deleteCharacter', () => {
    it('should delete a character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const character: Character = {
        id: 'main-character/_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/test/project/characters/main-character/_test-character.md',
      };

      (service as any).charactersSubject.next([character]);

      electronService.deleteFile.and.returnValue(Promise.resolve({ success: true }));

      await service.deleteCharacter('main-character/_test-character.md');

      const characters = (service as any).charactersSubject.value;
      expect(characters.find((c: Character) => c.id === 'main-character/_test-character.md')).toBeUndefined();
      expect(electronService.deleteFile).toHaveBeenCalled();
    });

    it('should return false when character does not exist', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      (service as any).charactersSubject.next([]);

      const result = await service.deleteCharacter('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getCategoryFolderPath', () => {
    it('should return null for flat mode', () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'flat';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const path = service.getCategoryFolderPath('main-character');
      expect(path).toBeNull();
    });

    it('should return slugified category id for auto mode', () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'auto';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const path = service.getCategoryFolderPath('main-character');
      expect(path).toBe('main-character');
    });

    it('should return custom folder path for specify mode', () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'specify';
      project.metadata.categories[0].folderPath = 'custom-folder';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const path = service.getCategoryFolderPath('main-character');
      expect(path).toBe('custom-folder');
    });
  });

  describe('getCategoryById', () => {
    it('should return category by id', () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const category = service.getCategoryById('main-character');
      expect(category).toBeTruthy();
      expect(category?.name).toBe('Main Character');
    });

    it('should return undefined for non-existent category', () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const category = service.getCategoryById('non-existent');
      expect(category).toBeUndefined();
    });
  });

  describe('forceReloadCharacters', () => {
    it('should reload characters from disk', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(Promise.resolve({
        success: true,
        files: []
      }));

      await service.forceReloadCharacters();

      expect(electronService.readDirectoryRecursive).toHaveBeenCalled();
    });
  });
});

