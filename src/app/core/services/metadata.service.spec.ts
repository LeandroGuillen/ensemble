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
      defaultCategory: 'main-character'
    }
  });

  const createValidProject = (): Project => ({
    path: '/test/project',
    metadata: createValidMetadata()
  });

  beforeEach(() => {
    const electronSpy = jasmine.createSpyObj('ElectronService', ['isElectron', 'readDirectoryRecursive', 'readFile', 'writeFile', 'writeFileAtomic', 'stageForTrash']);
    const projectSpy = jasmine.createSpyObj('ProjectService', ['getCurrentProject', 'updateMetadata', 'getCharactersFolderPath', 'getLocationsFolderPath'], {
      currentProject$: new BehaviorSubject<Project | null>(null)
    });
    const castSpy = jasmine.createSpyObj('CastService', ['createCast', 'updateCast', 'deleteCast']);
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']);
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
    projectService.getCharactersFolderPath.and.returnValue('/test/project/characters');
    projectService.getLocationsFolderPath.and.returnValue('/test/project/locations');
    electronService.readDirectoryRecursive.and.returnValue(Promise.resolve({ success: true, files: [] }));
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
      projectService.getCurrentProject.and.returnValue(null);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);

      const metadata = createValidMetadata();
      await expectAsync(service.saveMetadata(metadata)).toBeRejected();
    });

    it('should validate metadata before saving', async () => {
      const project = createValidProject();
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      const invalidMetadata: any = { projectName: '', version: '1.0.0', categories: [], tags: [], casts: [], books: [], settings: { defaultCategory: 'main' } };
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

    it('should add a tag with accented characters', async () => {
      const newTag = await service.addTag({
        name: 'Ceós',
        color: '#FFFF00'
      });

      expect(newTag.id).toBe('ceós');
      expect(newTag.name).toBe('Ceós');
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

    describe('book codes that slug to the same notes file', () => {
      const withBooks = (books: any[]) => {
        const project = createValidProject();
        project.metadata.books = books;
        projectService.getCurrentProject.and.returnValue(project);
        (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      };

      const pairs: [string, string][] = [
        ['lc1', 'LC1.'],
        ['B1', 'B.1'],
        ['A1', 'Á1'],
        ['n23', 'N23!'],
      ];

      pairs.forEach(([existing, candidate]) => {
        // addBook derives the id from the code, so an accented code is already
        // refused by id validation; the updateBook spec covers that pair.
        if (candidate !== 'Á1') it(`addBook refuses '${candidate}' next to '${existing}'`, async () => {
          withBooks([{ id: 'one', name: 'One', code: existing, color: '#000' }]);
          await expectAsync(service.addBook({ name: 'Two', code: candidate, color: '#111' })).toBeRejectedWithError(
            /would share character notes files/
          );
          expect(projectService.updateMetadata).not.toHaveBeenCalled();
        });

        it(`updateBook refuses changing a code to '${candidate}' next to '${existing}'`, async () => {
          withBooks([
            { id: 'one', name: 'One', code: existing, color: '#000' },
            { id: 'two', name: 'Two', code: 'zz9', color: '#111' },
          ]);
          await expectAsync(service.updateBook('two', { code: candidate })).toBeRejectedWithError(
            /would share character notes files/
          );
          expect(projectService.updateMetadata).not.toHaveBeenCalled();
        });
      });

      it('refuses a code that matches the id-based suffix of a book without a code', async () => {
        withBooks([
          { id: 'lc1', name: 'LC1', color: '#000' },
          { id: 'other', name: 'Other', code: 'zz9', color: '#111' },
        ]);
        await expectAsync(service.updateBook('other', { code: 'LC1.' })).toBeRejectedWithError(
          /would share character notes files \(\*\.lc1\.md\)/
        );
      });

      it('assertBookCodeAvailable reports exact and slug clashes without saving', () => {
        withBooks([
          { id: 'one', name: 'One', code: 'lc1', color: '#000' },
          { id: 'two', name: 'Two', code: 'lc2', color: '#111' },
        ]);
        expect(() => service.assertBookCodeAvailable('two', 'lc1')).toThrowError(/already used by another book/);
        expect(() => service.assertBookCodeAvailable('two', 'LC1.')).toThrowError(/would share character notes files/);
        expect(() => service.assertBookCodeAvailable('two', 'tb')).not.toThrow();
        expect(() => service.assertBookCodeAvailable('two', '')).not.toThrow();
        expect(projectService.updateMetadata).not.toHaveBeenCalled();
      });

      it('still allows saving a book with its own code and distinct codes', async () => {
        withBooks([
          { id: 'one', name: 'One', code: 'lc1', color: '#000' },
          { id: 'two', name: 'Two', code: 'lc2', color: '#111' },
        ]);
        await expectAsync(service.updateBook('one', { code: 'LC1', name: 'One again' })).toBeResolved();
        await expectAsync(service.addBook({ name: 'Three', code: 'lc3', color: '#222' })).toBeResolved();
      });
    });

    it('should remove a book', async () => {
      const project = createValidProject();
      project.metadata.books = [{ id: 'book-1', name: 'Book 1', color: '#FF0000' }];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);

      await service.removeBook('book-1');

      expect(projectService.updateMetadata).toHaveBeenCalled();
    });

    describe('removeBook cleanup', () => {
      /** Simulated project files: absolute path → content. */
      let files: Map<string, string>;
      let staged: string[];

      const C = '/test/project/characters';
      const L = '/test/project/locations';
      const H = '/test/project/houses';

      const listUnder = (dir: string, pattern: string) =>
        [...files.keys()]
          .filter((path) => path.startsWith(`${dir}/`))
          .filter((path) => {
            const name = path.slice(path.lastIndexOf('/') + 1);
            return pattern === '_*.md' ? name.startsWith('_') && name.endsWith('.md') : name.endsWith('.md');
          })
          .map((path) => ({ relativePath: path.slice(dir.length + 1), absolutePath: path }));

      beforeEach(() => {
        staged = [];
        files = new Map([
          [
            `${C}/mara-vell/mara-vell.md`,
            [
              '---',
              'id: mara',
              'name: Mara Vell',
              'category: main-character',
              'books:',
              '  - lc1',
              '  - lc2',
              'bookCategories:',
              '  lc2: main-character',
              'bookTags:',
              '  lc1:',
              '    - magic-user',
              '  lc2:',
              '    - magic-user',
              'thumbnails:',
              '  default: "[[img/mara.jpg]]"',
              'bookThumbnails:',
              '  lc1:',
              '    default: "[[img/mara-lc1.jpg]]"',
              '  lc2:',
              '    default: "[[img/mara-lc2.jpg]]"',
              '---',
              '',
              'Mara body.',
            ].join('\n'),
          ],
          [`${C}/mara-vell/mara-vell.lc1.md`, 'Notes for book one.'],
          [`${C}/mara-vell/mara-vell.lc2.md`, 'Notes for book two.'],
          [
            `${C}/@drafts/saffi-reed/saffi-reed.md`,
            ['---', 'id: saffi', 'name: Saffi Reed', 'books:', '  - lc2', '---', '', 'Draft.'].join('\n'),
          ],
          [`${C}/@drafts/saffi-reed/saffi-reed.lc2.md`, 'Draft notes for book two.'],
          [`${C}/_legacy-olm.md`, ['---', 'name: Olm', 'books:', '  - lc2', '---', '', 'Legacy.'].join('\n')],
          [`${C}/_legacy-olm-lc2.md`, 'Legacy notes for book two.'],
          [
            `${L}/coast/_vellhaven-lighthouse.md`,
            ['---', 'id: lighthouse', 'name: Vellhaven Lighthouse', 'books:', '  - lc1', '  - lc2', '---', '', 'Light.'].join('\n'),
          ],
          [
            `${L}/_grey-harbor.md`,
            ['---', 'id: harbor', 'name: Grey Harbor', 'books:', '  - lc1', '---', '', 'Harbor.'].join('\n'),
          ],
          [
            `${H}/vell/vell.md`,
            [
              '---',
              'type: house',
              'id: house-vell',
              'name: House Vell',
              'characterIds:',
              '  - mara',
              'leadership:',
              '  - id: reign-1',
              '    characterIds:',
              '      - mara',
              '    period: ""',
              '    books:',
              '      - lc1',
              '      - lc2',
              '    notes: ""',
              '---',
              '',
              'History.',
            ].join('\n'),
          ],
        ]);

        electronService.readDirectoryRecursive.and.callFake(async (dir: string, pattern: string) => ({
          success: true,
          files: listUnder(dir, pattern),
        }));
        electronService.readFile.and.callFake(async (path: string) =>
          files.has(path) ? { success: true, content: files.get(path)! } : { success: false, error: 'ENOENT' }
        );
        electronService.writeFileAtomic.and.callFake(async (path: string, content: string) => {
          files.set(path, content);
          return { success: true };
        });
        electronService.stageForTrash.and.callFake(async (_project: string, path: string) => {
          staged.push(path);
          files.delete(path);
          return { success: true, token: `t${staged.length}` };
        });

        const project = createValidProject();
        project.metadata.books = [
          { id: 'b1', name: 'Book One', code: 'lc1', color: '#FF0000' },
          { id: 'lc2', name: 'Book Two', code: 'LC2', color: '#00FF00' },
        ];
        projectService.getCurrentProject.and.returnValue(project);
        (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
      });

      it('moves the deleted book\'s character notes to the trash and keeps the others', async () => {
        await service.removeBook('lc2');

        expect(staged.sort()).toEqual([
          `${C}/@drafts/saffi-reed/saffi-reed.lc2.md`,
          `${C}/_legacy-olm-lc2.md`,
          `${C}/mara-vell/mara-vell.lc2.md`,
        ]);
        expect(electronService.stageForTrash).toHaveBeenCalledWith(
          '/test/project',
          `${C}/mara-vell/mara-vell.lc2.md`,
          jasmine.objectContaining({ kind: 'book-page', recordId: 'lc2' })
        );
        expect(files.get(`${C}/mara-vell/mara-vell.lc1.md`)).toBe('Notes for book one.');
        expect(service.getBooks().map((book) => book.id)).toEqual(['b1']);
      });

      it('strips the book from character books, bookThumbnails and other per-book overrides', async () => {
        await service.removeBook('lc2');

        const mara = files.get(`${C}/mara-vell/mara-vell.md`)!;
        expect(mara).not.toContain('lc2');
        expect(mara).not.toContain('mara-lc2.jpg');
        expect(mara).not.toContain('bookCategories');
        expect(mara).toContain('mara-lc1.jpg');
        expect(mara).toMatch(/books:\s*\n\s*- lc1/);
        expect(mara).toMatch(/bookTags:\s*\n\s*lc1:/);
        expect(mara).toContain('Mara body.');

        expect(files.get(`${C}/@drafts/saffi-reed/saffi-reed.md`)).not.toContain('lc2');
        expect(files.get(`${C}/_legacy-olm.md`)).not.toContain('lc2');
      });

      it('removes the book from location files', async () => {
        await service.removeBook('lc2');

        const lighthouse = files.get(`${L}/coast/_vellhaven-lighthouse.md`)!;
        expect(lighthouse).not.toContain('lc2');
        expect(lighthouse).toMatch(/books:\s*\n\s*- lc1/);
        expect(lighthouse).toContain('Light.');
        expect(electronService.writeFileAtomic).not.toHaveBeenCalledWith(`${L}/_grey-harbor.md`, jasmine.anything());
      });

      it('removes the book from House leadership book lists', async () => {
        await service.removeBook('lc2');

        const house = files.get(`${H}/vell/vell.md`)!;
        expect(house).not.toContain('lc2');
        expect(house).toContain('lc1');
        expect(house).toContain('reign-1');
        expect(house).toContain('History.');
      });

      it('touches no file when saving the metadata fails', async () => {
        projectService.updateMetadata.and.returnValue(Promise.reject(new Error('disk full')));

        await expectAsync(service.removeBook('lc2')).toBeRejected();

        expect(electronService.writeFileAtomic).not.toHaveBeenCalled();
        expect(electronService.stageForTrash).not.toHaveBeenCalled();
      });
    });
  });

  describe('deleting a category or tag cleans character files', () => {
    let files: Map<string, string>;
    const C = '/test/project/characters';

    const ilse = [
      '---',
      'id: ilse',
      'name: Ilse Dunmore',
      'category: main-character',
      'tags:',
      '  - magic-user',
      '  - tide-touched',
      'books:',
      '  - lc1',
      '  - lc2',
      'bookCategories:',
      '  lc1: antagonist',
      '  lc2: main-character',
      'bookTags:',
      '  lc1:',
      '    - magic-user',
      '    - tide-touched',
      '  lc2:',
      '    - tide-touched',
      '---',
      '',
      'Ilse body.',
    ].join('\n');

    beforeEach(() => {
      files = new Map([
        [`${C}/ilse-dunmore/ilse-dunmore.md`, ilse],
        [`${C}/ilse-dunmore/ilse-dunmore.lc1.md`, 'Notes tide-touched antagonist.'],
        [
          `${C}/@drafts/wren/wren.md`,
          ['---', 'id: wren', 'name: Wren', 'books:', '  - lc2', 'bookCategories:', '  lc2: antagonist', '---', '', 'Draft.'].join('\n'),
        ],
        [`${C}/plain/plain.md`, ['---', 'id: plain', 'name: Plain', 'category: main-character', '---', '', 'Plain.'].join('\n')],
      ]);
      electronService.readDirectoryRecursive.and.callFake(async (dir: string) => ({
        success: true,
        files: [...files.keys()]
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => ({ relativePath: path.slice(dir.length + 1), absolutePath: path })),
      }));
      electronService.readFile.and.callFake(async (path: string) =>
        files.has(path) ? { success: true, content: files.get(path)! } : { success: false, error: 'ENOENT' }
      );
      electronService.writeFileAtomic.and.callFake(async (path: string, content: string) => {
        files.set(path, content);
        return { success: true };
      });

      const project = createValidProject();
      project.metadata.categories.push({ id: 'antagonist', name: 'Antagonist', color: '#000000' });
      project.metadata.tags.push({ id: 'tide-touched', name: 'Tide Touched', color: '#00FFFF' });
      project.metadata.books = [
        { id: 'lc1', name: 'Book One', color: '#FF0000' },
        { id: 'lc2', name: 'Book Two', color: '#00FF00' },
      ];
      projectService.getCurrentProject.and.returnValue(project);
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(project);
    });

    it('removeTag strips the tag from main tags and per-book bookTags', async () => {
      await service.removeTag('tide-touched');

      const saved = files.get(`${C}/ilse-dunmore/ilse-dunmore.md`)!;
      expect(saved).not.toContain('tide-touched');
      expect(saved).toMatch(/tags:\s*\n\s*- magic-user/);
      expect(saved).toMatch(/bookTags:\s*\n\s*lc1:\s*\n\s*- magic-user/);
      expect(saved).not.toMatch(/lc2:\s*\n\s*-/); // the emptied lc2 override is gone
      expect(saved).toContain('lc1: antagonist');
      expect(saved).toContain('Ilse body.');
      // Book notes pages and files that never used the tag are not touched.
      expect(files.get(`${C}/ilse-dunmore/ilse-dunmore.lc1.md`)).toBe('Notes tide-touched antagonist.');
      expect(electronService.writeFileAtomic).not.toHaveBeenCalledWith(`${C}/plain/plain.md`, jasmine.anything());
      expect(service.getTags().map((tag) => tag.id)).toEqual(['magic-user']);
    });

    it('removeCategory strips the category from bookCategories, in drafts too, keeping other overrides', async () => {
      await service.removeCategory('antagonist');

      const saved = files.get(`${C}/ilse-dunmore/ilse-dunmore.md`)!;
      expect(saved).not.toContain('antagonist');
      expect(saved).toMatch(/bookCategories:\s*\n\s*lc2: main-character/);
      expect(saved).toContain('category: main-character');
      expect(saved).toContain('tide-touched');

      const draft = files.get(`${C}/@drafts/wren/wren.md`)!;
      expect(draft).not.toContain('antagonist');
      expect(draft).not.toContain('bookCategories');
      expect(electronService.writeFileAtomic).not.toHaveBeenCalledWith(`${C}/plain/plain.md`, jasmine.anything());
    });

    it('touches no character file when saving the metadata fails', async () => {
      projectService.updateMetadata.and.returnValue(Promise.reject(new Error('disk full')));

      await expectAsync(service.removeTag('tide-touched')).toBeRejected();
      await expectAsync(service.removeCategory('antagonist')).toBeRejected();

      expect(electronService.writeFileAtomic).not.toHaveBeenCalled();
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
        charactersFolder: 'personajes'
      });

      expect(updated.charactersFolder).toBe('personajes');
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
        id: '_char-1.md',
        name: 'Test Character',
        category: 'main-character',
        tags: ['magic-user'],
        books: [],
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_char-1.md',
        filePath: '/path/to/char/_char-1.md',
      };

      const result = service.validateCharacterAgainstMetadata(character);
      expect(result.isValid).toBe(true);
    });

    it('should return invalid when category does not exist', () => {
      const character: Character = {
        id: '_char-1.md',
        name: 'Test Character',
        category: 'non-existent',
        tags: [],
        books: [],
        prompts: [],
        content: '',
        created: new Date(),
        modified: new Date(),
        relativePath: '_char-1.md',
        filePath: '/path/to/char/_char-1.md',
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
        prompts: [],
        content: ''
      };

      const result = service.validateCharacterFormDataAgainstMetadata(formData);
      expect(result.isValid).toBe(true);
    });

    it('should return invalid when no metadata is loaded', () => {
      (projectService.currentProject$ as BehaviorSubject<Project | null>).next(null);

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

      const result = service.validateCharacterAgainstMetadata(character);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe('NO_METADATA');
    });
  });
});
