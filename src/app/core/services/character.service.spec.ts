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
    images: [],
    mangamaster: '',
    description: 'Test description',
    notes: 'Test notes'
  });

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', [
      'isElectron',
      'fileExists',
      'createDirectory',
      'readDirectoryFiles',
      'readFile',
      'writeFileAtomic',
      'moveDirectory',
      'copyFile',
      'deleteFile',
      'deleteDirectoryRecursive'
    ]);
    const projectSpy = jasmine.createSpyObj('ProjectService', ['getCurrentProject'], {
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
        id: 'char-1',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        images: [],
        mangamaster: '',
        description: '',
        notes: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/path/to/char.md',
        folderPath: '/path/to/char',
        additionalFields: {},
        additionalFieldsFilenames: {}
      };

      // Manually set characters in subject for testing
      (service as any).charactersSubject.next([character]);

      const found = service.getCharacterById('char-1');
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
      expect(electronService.createDirectory).toHaveBeenCalled();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
    });

    it('should throw error when no project is loaded', async () => {
      projectService.getCurrentProject.and.returnValue(null);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);

      const formData = createValidCharacterFormData();
      await expectAsync(service.createCharacter(formData)).toBeRejected();
    });

    it('should create character folder in flat mode', async () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'flat';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const formData = createValidCharacterFormData();
      await service.createCharacter(formData);

      // Should create character folder directly under characters/
      expect(electronService.createDirectory).toHaveBeenCalled();
    });

    it('should create character folder in category folder for auto mode', async () => {
      const project = createValidProject();
      project.metadata.categories[0].folderMode = 'auto';
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const formData = createValidCharacterFormData();
      await service.createCharacter(formData);

      // Should create category folder and character folder
      expect(electronService.createDirectory).toHaveBeenCalled();
    });
  });

  describe('updateCharacter', () => {
    it('should update an existing character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: 'char-1',
        name: 'Original Name',
        category: 'main-character',
        tags: [],
        books: [],
        images: [],
        mangamaster: '',
        description: '',
        notes: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/test/project/characters/main-character/original-name/original-name.md',
        folderPath: '/test/project/characters/main-character/original-name',
        additionalFields: {},
        additionalFieldsFilenames: {}
      };

      (service as any).charactersSubject.next([existingCharacter]);

      // Mock file operations for update (no name change, so no file rename needed)
      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
        success: true,
        files: ['original-name.md'],
        directories: []
      }));

      const updated = await service.updateCharacter('char-1', {
        description: 'Updated description'
      });

      expect(updated).toBeTruthy();
      expect(updated?.name).toBe('Original Name');
      expect(updated?.description).toBe('Updated description');
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

    it('should move character folder when category changes', async () => {
      const project = createValidProject();
      project.metadata.categories.push({ id: 'supporting', name: 'Supporting', color: '#00FF00' });
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: 'char-1',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        images: [],
        mangamaster: '',
        description: '',
        notes: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/test/project/characters/main-character/test-character/test-character.md',
        folderPath: '/test/project/characters/main-character/test-character',
        additionalFields: {},
        additionalFieldsFilenames: {}
      };

      (service as any).charactersSubject.next([existingCharacter]);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.moveDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('char-1', {
        category: 'supporting'
      });

      expect(updated).toBeTruthy();
      expect(updated?.category).toBe('supporting');
      expect(electronService.moveDirectory).toHaveBeenCalled();
    });
  });

  describe('deleteCharacter', () => {
    it('should delete a character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const character: Character = {
        id: 'char-1',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        images: [],
        mangamaster: '',
        description: '',
        notes: '',
        created: new Date(),
        modified: new Date(),
        filePath: '/test/project/characters/main-character/test-character/test-character.md',
        folderPath: '/test/project/characters/main-character/test-character',
        additionalFields: {},
        additionalFieldsFilenames: {}
      };

      (service as any).charactersSubject.next([character]);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.moveDirectory.and.returnValue(Promise.resolve({ success: true }));

      await service.deleteCharacter('char-1');

      const characters = (service as any).charactersSubject.value;
      expect(characters.find((c: Character) => c.id === 'char-1')).toBeUndefined();
      expect(electronService.moveDirectory).toHaveBeenCalled();
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
      electronService.readDirectoryFiles.and.returnValue(Promise.resolve({
        success: true,
        directories: [],
        files: []
      }));

      await service.forceReloadCharacters();

      expect(electronService.readDirectoryFiles).toHaveBeenCalled();
    });
  });
});

