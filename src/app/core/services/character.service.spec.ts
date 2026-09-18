import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { CharacterService } from './character.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { MetadataService } from './metadata.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { Project, ProjectMetadata } from '../interfaces/project.interface';
import { Character, CharacterFormData } from '../interfaces/character.interface';

describe('CharacterService', () => {
  let service: CharacterService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let fileWatcherService: jasmine.SpyObj<FileWatcherService>;
  let loggingService: jasmine.SpyObj<LoggingService>;
  let notificationService: jasmine.SpyObj<NotificationService>;
  let metadataService: jasmine.SpyObj<MetadataService>;
  let plotBoardService: jasmine.SpyObj<PlotBoardService>;
  let castService: jasmine.SpyObj<CastService>;

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
        defaultCategory: 'main-character'
      }
    }
  });

  const createValidCharacterFormData = (): CharacterFormData => ({
    name: 'Test Character',
    category: 'main-character',
    tags: ['magic-user'],
    books: [],
    prompts: [],
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
      'deleteDirectoryRecursive',
      'getFileStats',
    ]);
    electronSpy.getFileStats.and.returnValue(Promise.resolve({
      success: true,
      stats: { mtime: new Date('2024-01-02T00:00:00Z'), ctime: new Date('2024-01-01T00:00:00Z') },
    }));
    const projectSpy = jasmine.createSpyObj('ProjectService', [
      'getCurrentProject',
      'getCharactersFolderPath',
      'getDefaultCharacterStyle',
      'getCharacterStyles',
      'remapCharacterIds',
    ], {
      currentProject$: new BehaviorSubject<Project | null>(null)
    });
    projectSpy.getDefaultCharacterStyle.and.returnValue('default');
    projectSpy.getCharacterStyles.and.returnValue([{ id: 'default', name: 'Default' }]);
    const fileWatcherSpy = jasmine.createSpyObj('FileWatcherService', [], {
      fileChanges$: new BehaviorSubject<any>(null)
    });
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);
    const metadataSpy = jasmine.createSpyObj('MetadataService', ['removeCharacterFromBookPovs']);
    metadataSpy.removeCharacterFromBookPovs.and.returnValue(Promise.resolve());
    const plotBoardSpy = jasmine.createSpyObj('PlotBoardService', ['remapCharacterIdsAcrossProject']);
    plotBoardSpy.remapCharacterIdsAcrossProject.and.returnValue(Promise.resolve());
    const castSpy = jasmine.createSpyObj('CastService', ['forceReloadCasts']);
    castSpy.forceReloadCasts.and.returnValue(Promise.resolve());
    projectSpy.remapCharacterIds.and.returnValue(Promise.resolve(false));

    TestBed.configureTestingModule({
      providers: [
        CharacterService,
        { provide: ElectronService, useValue: electronSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: FileWatcherService, useValue: fileWatcherSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy },
        { provide: MetadataService, useValue: metadataSpy },
        { provide: PlotBoardService, useValue: plotBoardSpy },
        { provide: CastService, useValue: castSpy }
      ]
    });

    service = TestBed.inject(CharacterService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
    projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
    fileWatcherService = TestBed.inject(FileWatcherService) as jasmine.SpyObj<FileWatcherService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
    notificationService = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
    metadataService = TestBed.inject(MetadataService) as jasmine.SpyObj<MetadataService>;
    plotBoardService = TestBed.inject(PlotBoardService) as jasmine.SpyObj<PlotBoardService>;
    castService = TestBed.inject(CastService) as jasmine.SpyObj<CastService>;

    electronService.isElectron.and.returnValue(true);
    electronService.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.moveDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronService.deleteDirectoryRecursive.and.returnValue(Promise.resolve({ success: true }));
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
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_char-1.md',
        filePath: '/path/to/char/_char-1.md',
      };

      (service as any).charactersSubject.next([character]);

      const found = service.getCharacterById('_char-1.md');
      expect(found).toBeTruthy();
      expect(found?.name).toBe('Test Character');
    });

    it('should find a character by leftover path when id is stable', () => {
      const character: Character = {
        id: 'stable-id-1',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_char-1.md',
        filePath: '/path/to/char/_char-1.md',
      };

      (service as any).charactersSubject.next([character]);

      expect(service.getCharacterById('stable-id-1')?.name).toBe('Test Character');
      expect(service.getCharacterById('_char-1.md')?.id).toBe('stable-id-1');
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
      expect(character.relativePath).toBe('test-character/test-character.md');
      expect(character.id).toBeTruthy();
      expect(character.id).not.toBe(character.relativePath);
      expect(electronService.createDirectory).toHaveBeenCalledWith(
        '/test/project/characters/test-character'
      );
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).toContain(`id: ${character.id}`);
    });

    it('should persist aliases in frontmatter and omit them when empty', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const withAliases = await service.createCharacter({
        ...createValidCharacterFormData(),
        name: 'Dessir Galsea',
        aliases: ['Dess', 'The Grey Witch', 'dess'],
      });

      expect(withAliases.aliases).toEqual(['Dess', 'The Grey Witch']);
      const savedWith = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedWith).toContain('aliases:');
      expect(savedWith).toContain('Dess');
      expect(savedWith).toContain('The Grey Witch');

      const withoutAliases = await service.createCharacter(createValidCharacterFormData());
      expect(withoutAliases.aliases).toEqual([]);
      const savedWithout = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedWithout).not.toContain('aliases:');
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

      // Category folder settings do not affect the character-centric layout.
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
      expect(electronService.createDirectory).toHaveBeenCalledWith(
        '/test/project/characters/test-character'
      );
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
      expect(electronService.createDirectory).toHaveBeenCalledWith(
        '/test/project/characters/test-character'
      );
    });

    it('adds part of the stable id when the name slug collides', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.fileExists.and.callFake((path: string) =>
        Promise.resolve(path === '/test/project/characters/test-character')
      );
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const character = await service.createCharacter(createValidCharacterFormData());

      expect(character.relativePath).toMatch(
        /^test-character-[a-z0-9]+\/test-character-[a-z0-9]+\.md$/
      );
      expect(character.relativePath).toContain(character.id.slice(-8));
    });

    it('uses ASCII-only folder and main-file names', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const character = await service.createCharacter({
        ...createValidCharacterFormData(),
        name: 'José García',
      });

      expect(character.relativePath).toBe('jose-garcia/jose-garcia.md');
      expect([...character.relativePath].every((char) => char.charCodeAt(0) < 128)).toBeTrue();
    });
  });

  describe('character drafts', () => {
    it('creates a completely empty draft without exposing it as an active character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const draft = await service.createDraft({
        name: '',
        category: '',
        tags: [],
        books: [],
        prompts: [],
        content: '',
      });

      expect(draft.draft).toBeTrue();
      expect(draft.name).toBe('');
      expect(service.getCharacterById(draft.id)).toBeUndefined();
      expect(service.getDraftById(draft.id)?.id).toBe(draft.id);
      expect(draft.relativePath).toBe('@drafts/unnamed/unnamed.md');
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).not.toContain('draft: true');
    });

    it('loads drafts separately, including a draft with no name', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(Promise.resolve({
        success: true,
        files: [
          { relativePath: '_active.md', absolutePath: '/test/project/characters/_active.md' },
          { relativePath: '_draft-one.md', absolutePath: '/test/project/characters/_draft-one.md' },
        ],
      }));
      electronService.readFile.and.callFake((path: string) => Promise.resolve({
        success: true,
        content: path.endsWith('_active.md')
          ? '---\nid: active-1\nname: Active\ncategory: main-character\n---\n'
          : '---\nid: draft-1\ndraft: true\n---\nDraft notes',
      }));

      await service.forceReloadCharacters();

      expect(service.getCharactersSnapshot().map((item) => item.id)).toEqual(['active-1']);
      expect(service.getDraftsSnapshot().map((item) => item.id)).toEqual(['draft-1']);
      expect(service.getDraftById('draft-1')?.name).toBe('');
    });

    it('promotes only an explicitly requested complete draft', async () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#334455' }];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const draft = await service.createDraft({
        ...createValidCharacterFormData(),
        books: ['book-1'],
      });
      expect(service.getCharacterById(draft.id)).toBeUndefined();
      expect(service.getDraftById(draft.id)?.books).toEqual(['book-1']);
      const promoted = await service.promoteDraft(draft.id);

      expect(promoted.draft).toBeUndefined();
      expect(service.getDraftById(draft.id)).toBeUndefined();
      expect(service.getCharacterById(draft.id)?.name).toBe('Test Character');
      expect(promoted.books).toEqual(['book-1']);
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).not.toContain('draft: true');
    });

    it('refuses to promote a draft without a name or category', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      const draft = await service.createDraft({
        name: '',
        category: '',
        tags: [],
        books: [],
        prompts: [],
        content: '',
      });

      await expectAsync(service.promoteDraft(draft.id)).toBeRejectedWithError(
        'A name is required before promoting this draft'
      );
      expect(service.getDraftById(draft.id)).toBeDefined();
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
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'main-character/_original-name.md',
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

    it('should clear thumbnails when an empty map is saved', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: 'main-character/_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: [],
        prompts: [],
        thumbnails: { default: '[[img/portrait.png]]' },
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'main-character/_test-character.md',
        filePath: '/test/project/characters/main-character/_test-character.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('main-character/_test-character.md', {
        thumbnails: {},
      });

      expect(updated?.thumbnails).toBeUndefined();
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).not.toContain('thumbnails:');
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
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'main-character/_test-character.md',
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

    it('should persist bookCategories and prune overrides for removed books', async () => {
      const project = createValidProject();
      project.metadata.categories.push({ id: 'supporting', name: 'Supporting', color: '#00FF00' });
      project.metadata.books = [
        { id: 'book-1', name: 'Book 1', color: '#111' },
        { id: 'book-2', name: 'Book 2', color: '#222' },
      ];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: '_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: ['book-1', 'book-2'],
        bookCategories: { 'book-1': 'supporting', 'book-2': 'main-character' },
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_test-character.md',
        filePath: '/test/project/characters/_test-character.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('_test-character.md', {
        books: ['book-2'],
        bookCategories: { 'book-1': 'supporting', 'book-2': 'supporting' },
      });

      expect(updated?.books).toEqual(['book-2']);
      expect(updated?.bookCategories).toEqual({ 'book-2': 'supporting' });
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).toContain('bookCategories:');
      expect(savedContent).toContain('book-2: supporting');
      expect(savedContent).not.toContain('book-1:');
    });

    it('should omit empty bookCategories from saved frontmatter', async () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#111' }];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: '_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: ['book-1'],
        bookCategories: { 'book-1': 'main-character' },
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_test-character.md',
        filePath: '/test/project/characters/_test-character.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('_test-character.md', {
        bookCategories: {},
      });

      expect(updated?.bookCategories).toBeUndefined();
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).not.toContain('bookCategories:');
    });

    it('should persist bookTags and prune overrides for removed books', async () => {
      const project = createValidProject();
      project.metadata.tags.push({ id: 'cursed', name: 'Cursed', color: '#FF00FF' });
      project.metadata.books = [
        { id: 'book-1', name: 'Book 1', color: '#111' },
        { id: 'book-2', name: 'Book 2', color: '#222' },
      ];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: '_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: ['magic-user'],
        books: ['book-1', 'book-2'],
        bookTags: { 'book-1': ['cursed'], 'book-2': ['magic-user'] },
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_test-character.md',
        filePath: '/test/project/characters/_test-character.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('_test-character.md', {
        books: ['book-2'],
        bookTags: { 'book-1': ['cursed'], 'book-2': ['cursed'] },
      });

      expect(updated?.books).toEqual(['book-2']);
      expect(updated?.bookTags).toEqual({ 'book-2': ['cursed'] });
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).toContain('bookTags:');
      expect(savedContent).toContain('book-2:');
      expect(savedContent).toContain('cursed');
      expect(savedContent).not.toContain('book-1:');
    });

    it('should omit empty bookTags from saved frontmatter', async () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#111' }];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: '_test-character.md',
        name: 'Test Character',
        category: 'main-character',
        tags: [],
        books: ['book-1'],
        bookTags: { 'book-1': ['magic-user'] },
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_test-character.md',
        filePath: '/test/project/characters/_test-character.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('_test-character.md', {
        bookTags: {},
      });

      expect(updated?.bookTags).toBeUndefined();
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).not.toContain('bookTags:');
    });

    it('should keep a stable id when the character is renamed', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const existingCharacter: Character = {
        id: 'stable-id-1',
        name: 'Original Name',
        category: 'main-character',
        tags: [],
        books: [],
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'main-character/_original-name.md',
        filePath: '/test/project/characters/main-character/_original-name.md',
      };

      (service as any).charactersSubject.next([existingCharacter]);
      electronService.moveDirectory.and.returnValue(Promise.resolve({ success: true }));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('stable-id-1', {
        name: 'New Name',
      });

      expect(updated?.id).toBe('stable-id-1');
      expect(updated?.relativePath).toBe('main-character/_new-name.md');
      expect(updated?.filePath).toBe('/test/project/characters/main-character/_new-name.md');
      expect(electronService.moveDirectory).toHaveBeenCalled();
    });

    it('renames a folder-based character directory and main file together', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      const existingCharacter: Character = {
        id: 'stable-id-1',
        name: 'Roger Rabbit',
        category: 'main-character',
        tags: [],
        books: [],
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'roger-rabbit/roger-rabbit.md',
        filePath: '/test/project/characters/roger-rabbit/roger-rabbit.md',
      };
      (service as any).charactersSubject.next([existingCharacter]);
      electronService.fileExists.and.returnValue(Promise.resolve(false));
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      const updated = await service.updateCharacter('stable-id-1', { name: 'Jessica Rabbit' });

      expect(updated?.relativePath).toBe('jessica-rabbit/jessica-rabbit.md');
      expect(electronService.moveDirectory).toHaveBeenCalledWith(
        '/test/project/characters/roger-rabbit',
        '/test/project/characters/jessica-rabbit'
      );
      expect(electronService.moveDirectory).toHaveBeenCalledWith(
        '/test/project/characters/jessica-rabbit/roger-rabbit.md',
        '/test/project/characters/jessica-rabbit/jessica-rabbit.md'
      );
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
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'main-character/_test-character.md',
        filePath: '/test/project/characters/main-character/_test-character.md',
      };

      (service as any).charactersSubject.next([character]);

      electronService.deleteFile.and.returnValue(Promise.resolve({ success: true }));

      await service.deleteCharacter('main-character/_test-character.md');

      const characters = (service as any).charactersSubject.value;
      expect(characters.find((c: Character) => c.id === 'main-character/_test-character.md')).toBeUndefined();
      expect(electronService.deleteFile).toHaveBeenCalled();
      expect(metadataService.removeCharacterFromBookPovs).toHaveBeenCalledWith('main-character/_test-character.md');
    });

    it('should return false when character does not exist', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      (service as any).charactersSubject.next([]);

      const result = await service.deleteCharacter('non-existent');
      expect(result).toBe(false);
    });

    it('deletes the whole folder for a folder-based character', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      const character: Character = {
        id: 'roger-id',
        name: 'Roger Rabbit',
        category: 'main-character',
        tags: [],
        books: [],
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: 'roger-rabbit/roger-rabbit.md',
        filePath: '/test/project/characters/roger-rabbit/roger-rabbit.md',
      };
      (service as any).charactersSubject.next([character]);

      expect(await service.deleteCharacter(character.id)).toBeTrue();
      expect(electronService.deleteDirectoryRecursive).toHaveBeenCalledWith(
        '/test/project/characters/roger-rabbit'
      );
      expect(electronService.deleteFile).not.toHaveBeenCalled();
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

    it('should load bookCategories from character frontmatter', async () => {
      const project = createValidProject();
      project.metadata.categories.push({ id: 'supporting', name: 'Supporting', color: '#00FF00' });
      project.metadata.books = [
        { id: 'book-1', name: 'Book 1', color: '#111' },
        { id: 'book-2', name: 'Book 2', color: '#222' },
      ];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: '_dessir.md',
              absolutePath: '/test/project/characters/_dessir.md',
            },
          ],
        })
      );
      electronService.readFile.and.returnValue(
        Promise.resolve({
          success: true,
          content: `---
name: Dessir
category: antagonist
books:
  - book-1
  - book-2
bookCategories:
  book-2: supporting
---

Body text
`,
        })
      );

      await service.forceReloadCharacters();

      const characters = (service as any).charactersSubject.value as Character[];
      expect(characters.length).toBe(1);
      expect(characters[0].category).toBe('antagonist');
      expect(characters[0].books).toEqual(['book-1', 'book-2']);
      expect(characters[0].bookCategories).toEqual({ 'book-2': 'supporting' });
    });

    it('should load bookTags from character frontmatter', async () => {
      const project = createValidProject();
      project.metadata.tags.push({ id: 'cursed', name: 'Cursed', color: '#FF00FF' });
      project.metadata.books = [
        { id: 'book-1', name: 'Book 1', color: '#111' },
        { id: 'book-2', name: 'Book 2', color: '#222' },
      ];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: '_dessir.md',
              absolutePath: '/test/project/characters/_dessir.md',
            },
          ],
        })
      );
      electronService.readFile.and.returnValue(
        Promise.resolve({
          success: true,
          content: `---
name: Dessir
category: antagonist
tags:
  - magic-user
books:
  - book-1
  - book-2
bookTags:
  book-2:
    - cursed
---

Body text
`,
        })
      );

      await service.forceReloadCharacters();

      const characters = (service as any).charactersSubject.value as Character[];
      expect(characters.length).toBe(1);
      expect(characters[0].tags).toEqual(['magic-user']);
      expect(characters[0].bookTags).toEqual({ 'book-2': ['cursed'] });
    });

    it('loads only conventionally named main files from character folders', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(Promise.resolve({
        success: true,
        files: [
          {
            relativePath: 'roger-rabbit/roger-rabbit.md',
            absolutePath: '/test/project/characters/roger-rabbit/roger-rabbit.md',
          },
          {
            relativePath: 'roger-rabbit/roger-rabbit.n26.md',
            absolutePath: '/test/project/characters/roger-rabbit/roger-rabbit.n26.md',
          },
          {
            relativePath: 'roger-rabbit/notes.md',
            absolutePath: '/test/project/characters/roger-rabbit/notes.md',
          },
          {
            relativePath: '@drafts/unnamed/unnamed.md',
            absolutePath: '/test/project/characters/@drafts/unnamed/unnamed.md',
          },
        ],
      }));
      electronService.readFile.and.callFake((path: string) => Promise.resolve({
        success: true,
        content: path.includes('@drafts')
          ? '---\nid: draft-id\n---\nDraft notes'
          : '---\nid: roger-id\nname: Roger Rabbit\ncategory: main-character\n---\nMain',
      }));

      await service.forceReloadCharacters();

      expect(service.getCharactersSnapshot().map((item) => item.id)).toEqual(['roger-id']);
      expect(service.getDraftsSnapshot().map((item) => item.id)).toEqual(['draft-id']);
      expect(electronService.readFile).toHaveBeenCalledTimes(2);
      expect(electronService.readDirectoryRecursive).toHaveBeenCalledWith(
        '/test/project/characters',
        '*.md'
      );
    });

    it('uses the book code in book-page filenames', () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-26', code: 'n26', name: 'Book 26', color: '#111' }];
      projectService.getCurrentProject.and.returnValue(project);
      const character = {
        relativePath: 'roger-rabbit/roger-rabbit.md',
        filePath: '/test/project/characters/roger-rabbit/roger-rabbit.md',
      } as Character;

      expect(service.getBookPageFilePath(character, 'book-26')).toBe(
        '/test/project/characters/roger-rabbit/roger-rabbit.n26.md'
      );
    });

    it('transliterates book codes to ASCII in book-page filenames', () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-26', code: 'Ñ 26', name: 'Book 26', color: '#111' }];
      projectService.getCurrentProject.and.returnValue(project);
      const character = {
        relativePath: 'jose-garcia/jose-garcia.md',
        filePath: '/test/project/characters/jose-garcia/jose-garcia.md',
      } as Character;

      expect(service.getBookPageFilePath(character, 'book-26')).toBe(
        '/test/project/characters/jose-garcia/jose-garcia.n-26.md'
      );
    });

    it('should load aliases from character frontmatter', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: '_dessir.md',
              absolutePath: '/test/project/characters/_dessir.md',
            },
          ],
        })
      );
      electronService.readFile.and.returnValue(
        Promise.resolve({
          success: true,
          content: `---
id: dessir-1
name: Dessir Galsea
aliases:
  - Dess
  - The Grey Witch
category: main-character
---

Body text
`,
        })
      );

      await service.forceReloadCharacters();

      const characters = (service as any).charactersSubject.value as Character[];
      expect(characters.length).toBe(1);
      expect(characters[0].aliases).toEqual(['Dess', 'The Grey Witch']);
    });

    it('should assign and persist a stable id when frontmatter has none', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: '_dessir.md',
              absolutePath: '/test/project/characters/_dessir.md',
            },
          ],
        })
      );
      electronService.readFile.and.returnValue(
        Promise.resolve({
          success: true,
          content: `---
name: Dessir
category: antagonist
---

Body text
`,
        })
      );
      electronService.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));

      await service.forceReloadCharacters();

      const characters = (service as any).charactersSubject.value as Character[];
      expect(characters.length).toBe(1);
      expect(characters[0].relativePath).toBe('_dessir.md');
      expect(characters[0].id).toBeTruthy();
      expect(characters[0].id).not.toBe('_dessir.md');
      expect(electronService.writeFileAtomic).toHaveBeenCalled();
      expect(projectService.remapCharacterIds).toHaveBeenCalled();
      expect(plotBoardService.remapCharacterIdsAcrossProject).toHaveBeenCalled();
      const savedContent = electronService.writeFileAtomic.calls.mostRecent().args[1] as string;
      expect(savedContent).toContain(`id: ${characters[0].id}`);
    });

    it('should keep an existing frontmatter id and skip persist', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      electronService.fileExists.and.returnValue(Promise.resolve(true));
      electronService.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: '_dessir.md',
              absolutePath: '/test/project/characters/_dessir.md',
            },
          ],
        })
      );
      electronService.readFile.and.returnValue(
        Promise.resolve({
          success: true,
          content: `---
id: existing-stable-id
name: Dessir
category: antagonist
---

Body text
`,
        })
      );

      await service.forceReloadCharacters();

      const characters = (service as any).charactersSubject.value as Character[];
      expect(characters[0].id).toBe('existing-stable-id');
      expect(electronService.writeFileAtomic).not.toHaveBeenCalled();
      expect(projectService.remapCharacterIds).toHaveBeenCalled();
    });
  });
});
