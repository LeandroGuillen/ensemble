import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { MetadataService } from './metadata.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { CastService } from './cast.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { Project, ProjectMetadata, Category, Tag, Book, ProjectSettings } from '../interfaces/project.interface';
import { Character, CharacterFormData } from '../interfaces/character.interface';

describe('MetadataService', () => {
  let service: MetadataService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let castService: jasmine.SpyObj<CastService>;
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

  const createValidProject = (): Project => ({
    path: '/test/project',
    metadata: createValidMetadata()
  });

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', ['isElectron']);
    const projectSpy = jasmine.createSpyObj('ProjectService', ['getCurrentProject', 'updateMetadata'], {
      currentProject$: new BehaviorSubject<Project | null>(null)
    });
    const castSpy = jasmine.createSpyObj('CastService', ['createCast', 'updateCast', 'deleteCast']);
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);

    TestBed.configureTestingModule({
      providers: [
        MetadataService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: CastService, useValue: castSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy }
      ]
    });

    service = TestBed.inject(MetadataService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    castService = TestBed.inject(CastService) as jasmine.SpyObj<CastService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
    notificationService = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;

    projectService.getCurrentProject.and.returnValue(createValidProject());
    projectService.updateMetadata.and.returnValue(Promise.resolve());
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getCurrentMetadata', () => {
    it('should return current metadata', () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const metadata = service.getCurrentMetadata();
      expect(metadata).toBeTruthy();
      expect(metadata?.projectName).toBe('Test Project');
    });

    it('should return null when no project is loaded', () => {
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);
      const metadata = service.getCurrentMetadata();
      expect(metadata).toBeNull();
    });
  });

  describe('loadMetadata', () => {
    it('should load metadata from project', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);

      const metadata = await service.loadMetadata('/test/project');

      expect(metadata).toBeTruthy();
      expect(metadata.projectName).toBe('Test Project');
    });

    it('should throw error when project is not loaded', async () => {
      projectService.getCurrentProject.and.returnValue(null);

      await expectAsync(service.loadMetadata('/test/project')).toBeRejected();
    });

    it('should throw error when project path does not match', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);

      await expectAsync(service.loadMetadata('/different/path')).toBeRejected();
    });
  });

  describe('saveMetadata', () => {
    it('should save metadata via ProjectService', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const metadata = createValidMetadata();
      await service.saveMetadata(metadata);

      expect(projectService.updateMetadata).toHaveBeenCalledWith(metadata);
    });

    it('should throw error when no project path is set', async () => {
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);

      const metadata = createValidMetadata();
      await expectAsync(service.saveMetadata(metadata)).toBeRejected();
    });

    it('should validate metadata before saving', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const invalidMetadata: any = { projectName: '', version: '1.0.0', categories: [], tags: [], casts: [], books: [], settings: { defaultCategory: 'main', autoSave: true, fileWatchEnabled: true } };
      await expectAsync(service.saveMetadata(invalidMetadata)).toBeRejected();
    });
  });

  describe('Category Management', () => {
    beforeEach(() => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
    });

    it('should get all categories', () => {
      const categories = service.getCategories();
      expect(categories.length).toBeGreaterThan(0);
      expect(categories[0].id).toBe('main-character');
    });

    it('should get category by ID', () => {
      const category = service.getCategoryById('main-character');
      expect(category).toBeTruthy();
      expect(category?.name).toBe('Main Character');
    });

    it('should return undefined for non-existent category', () => {
      const category = service.getCategoryById('non-existent');
      expect(category).toBeUndefined();
    });

    it('should add a new category', async () => {
      const newCategory = await service.addCategory({
        name: 'Supporting Character',
        color: '#00FF00'
      });

      expect(newCategory).toBeTruthy();
      expect(newCategory.name).toBe('Supporting Character');
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should throw error when adding duplicate category', async () => {
      await expectAsync(service.addCategory({
        name: 'Main Character',
        color: '#FF0000'
      })).toBeRejected();
    });

    it('should update an existing category', async () => {
      const updated = await service.updateCategory('main-character', {
        name: 'Updated Name'
      });

      expect(updated.name).toBe('Updated Name');
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should throw error when updating non-existent category', async () => {
      await expectAsync(service.updateCategory('non-existent', {
        name: 'Updated'
      })).toBeRejected();
    });

    it('should remove a category', async () => {
      const project = createValidProject();
      project.metadata.categories.push({ id: 'supporting', name: 'Supporting', color: '#00FF00' });
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      await service.removeCategory('supporting');

      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should throw error when removing default category', async () => {
      await expectAsync(service.removeCategory('main-character')).toBeRejected();
    });
  });

  describe('Tag Management', () => {
    beforeEach(() => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
    });

    it('should get all tags', () => {
      const tags = service.getTags();
      expect(tags.length).toBeGreaterThan(0);
      expect(tags[0].id).toBe('magic-user');
    });

    it('should get tag by ID', () => {
      const tag = service.getTagById('magic-user');
      expect(tag).toBeTruthy();
      expect(tag?.name).toBe('Magic User');
    });

    it('should return undefined for non-existent tag', () => {
      const tag = service.getTagById('non-existent');
      expect(tag).toBeUndefined();
    });

    it('should add a new tag', async () => {
      const newTag = await service.addTag({
        name: 'Warrior',
        color: '#FFFF00'
      });

      expect(newTag).toBeTruthy();
      expect(newTag.name).toBe('Warrior');
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should throw error when adding duplicate tag', async () => {
      await expectAsync(service.addTag({
        name: 'Magic User',
        color: '#0000FF'
      })).toBeRejected();
    });

    it('should update an existing tag', async () => {
      const updated = await service.updateTag('magic-user', {
        name: 'Updated Tag'
      });

      expect(updated.name).toBe('Updated Tag');
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should throw error when updating non-existent tag', async () => {
      await expectAsync(service.updateTag('non-existent', {
        name: 'Updated'
      })).toBeRejected();
    });

    it('should remove a tag', async () => {
      await service.removeTag('magic-user');

      expect(projectService.updateMetadata).toHaveBeenCalled();
    });
  });

  describe('Book Management', () => {
    beforeEach(() => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
    });

    it('should get all books', () => {
      const books = service.getBooks();
      expect(Array.isArray(books)).toBe(true);
    });

    it('should add a new book', async () => {
      const newBook = await service.addBook({
        name: 'Test Book',
        color: '#FF0000'
      });

      expect(newBook).toBeTruthy();
      expect(newBook.name).toBe('Test Book');
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should update an existing book', async () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#FF0000' }];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const updated = await service.updateBook('book-1', {
        name: 'Updated Book'
      });

      expect(updated.name).toBe('Updated Book');
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should remove a book', async () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#FF0000' }];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      await service.removeBook('book-1');

      expect(projectService.updateMetadata).toHaveBeenCalled();
    });
  });

  describe('Settings Management', () => {
    beforeEach(() => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
    });

    it('should get current settings', () => {
      const settings = service.getSettings();
      expect(settings).toBeTruthy();
      expect(settings?.defaultCategory).toBe('main-character');
    });

    it('should update settings', async () => {
      const updated = await service.updateSettings({
        autoSave: false
      });

      expect(updated.autoSave).toBe(false);
      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    it('should throw error when updating defaultCategory to non-existent category', async () => {
      await expectAsync(service.updateSettings({
        defaultCategory: 'non-existent'
      })).toBeRejected();
    });
  });

  describe('Validation Methods', () => {
    beforeEach(() => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
    });

    it('should validate character against metadata', () => {
      const character: Character = {
        id: 'char-1',
        name: 'Test Character',
        category: 'main-character',
        tags: ['magic-user'],
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

      const result = service.validateCharacterAgainstMetadata(character);
      expect(result.isValid).toBe(true);
    });

    it('should return invalid when category does not exist', () => {
      const character: Character = {
        id: 'char-1',
        name: 'Test Character',
        category: 'non-existent',
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

      const result = service.validateCharacterAgainstMetadata(character);
      expect(result.isValid).toBe(false);
    });

    it('should validate character form data against metadata', () => {
      const formData: CharacterFormData = {
        name: 'Test Character',
        category: 'main-character',
        tags: ['magic-user'],
        books: [],
        images: [],
        mangamaster: '',
        description: '',
        notes: ''
      };

      const result = service.validateCharacterFormDataAgainstMetadata(formData);
      expect(result.isValid).toBe(true);
    });

    it('should return invalid when no metadata is loaded', () => {
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);

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

      const result = service.validateCharacterAgainstMetadata(character);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe('NO_METADATA');
    });
  });
});

