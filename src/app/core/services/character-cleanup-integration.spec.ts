import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { CharacterService } from './character.service';
import { PinboardService } from './pinboard.service';
import { ReferenceCleanupService } from './reference-cleanup.service';
import { HouseService } from './house.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { Project } from '../interfaces/project.interface';
import { Character } from '../interfaces/character.interface';

/**
 * Integration spec that uses the real DI graph to verify no circular dependencies
 * and that cleanup actually works through the real services.
 */
describe('Character Cleanup Integration (Real DI)', () => {
  let characterService: CharacterService;
  let pinboardService: PinboardService;
  let houseService: HouseService;
  let projectService: ProjectService;
  let electronService: jasmine.SpyObj<ElectronService>;
  let project$: BehaviorSubject<Project | null>;

  const createTestProject = (): Project => ({
    path: '/test/project',
    metadata: {
      projectName: 'Test Project',
      version: '1.0.0',
      categories: [{ id: 'main', name: 'Main', color: '#FF0000' }],
      tags: [],
      casts: [],
      books: [],
      settings: { defaultCategory: 'main' },
      pinboards: [
        {
          id: 'pinboard-1',
          name: 'Test Pinboard',
          nodes: [
            { id: 'char-1', name: 'Character 1', position: { x: 0, y: 0 } },
            { id: 'char-2', name: 'Character 2', position: { x: 100, y: 100 } }
          ],
          edges: [
            { id: 'edge-1', source: 'char-1', target: 'char-2', type: 'relationship', label: 'knows', color: '#000000' }
          ]
        }
      ]
    }
  });

  beforeEach(() => {
    project$ = new BehaviorSubject<Project | null>(createTestProject());

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
      'getImageAsDataUrl'
    ]);
    electronSpy.isElectron.and.returnValue(true);
    electronSpy.fileExists.and.returnValue(Promise.resolve(false));
    electronSpy.createDirectory.and.returnValue(Promise.resolve({ success: true }));
    electronSpy.readDirectoryRecursive.and.returnValue(Promise.resolve({ success: true, files: [] }));
    electronSpy.readFile.and.returnValue(Promise.resolve({ success: false, error: 'Not found' }));
    electronSpy.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
    electronSpy.deleteFile.and.returnValue(Promise.resolve({ success: true }));
    electronSpy.deleteDirectoryRecursive.and.returnValue(Promise.resolve({ success: true }));
    electronSpy.getFileStats.and.returnValue(Promise.resolve({
      success: true,
      stats: { mtime: new Date(), ctime: new Date() }
    }));
    electronSpy.getImageAsDataUrl.and.returnValue(Promise.resolve(null));

    const fileWatcherSpy = jasmine.createSpyObj('FileWatcherService', [], {
      fileChanges$: new BehaviorSubject<any>(null)
    });

    const loggingSpy = jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', ['showError']);

    TestBed.configureTestingModule({
      providers: [
        // Real services that form the DI graph
        CharacterService,
        PinboardService,
        ReferenceCleanupService,
        HouseService,
        PlotBoardService,
        CastService,
        MetadataService,
        // Stub only non-core services
        { provide: ElectronService, useValue: electronSpy },
        { provide: FileWatcherService, useValue: fileWatcherSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy },
        {
          provide: ProjectService,
          useValue: {
            currentProject$: project$,
            getCurrentProject: () => project$.value,
            getCurrentPinboard: () => project$.value?.metadata?.pinboards?.[0] || null,
            getCharactersFolderPath: () => '/test/project/characters',
            getDefaultCharacterStyle: () => 'default',
            getCharacterStyles: () => [{ id: 'default', name: 'Default' }],
            remapCharacterIds: jasmine.createSpy('remapCharacterIds').and.returnValue(Promise.resolve(false)),
            updateProject: jasmine.createSpy('updateProject').and.returnValue(Promise.resolve()),
            updatePinboardById: jasmine.createSpy('updatePinboardById').and.returnValue(Promise.resolve()),
            saveProjectMetadata: jasmine.createSpy('saveProjectMetadata').and.returnValue(Promise.resolve())
          }
        }
      ]
    });

    characterService = TestBed.inject(CharacterService);
    pinboardService = TestBed.inject(PinboardService);
    houseService = TestBed.inject(HouseService);
    projectService = TestBed.inject(ProjectService);
    electronService = TestBed.inject(ElectronService) as jasmine.SpyObj<ElectronService>;
  });

  it('should construct CharacterService without NG0200 circular dependency error', () => {
    expect(characterService).toBeTruthy();
  });

  it('should construct PinboardService without NG0200 circular dependency error', () => {
    expect(pinboardService).toBeTruthy();
  });

  it('should construct ReferenceCleanupService without NG0200 circular dependency error', () => {
    const cleanupService = TestBed.inject(ReferenceCleanupService);
    expect(cleanupService).toBeTruthy();
  });

  it('should count character references in pinboards through real services', async () => {
    // Set up a character in the service
    const character: Character = {
      id: 'char-1',
      name: 'Character 1',
      category: 'main',
      tags: [],
      books: [],
      prompts: [],
      content: '',
      created: new Date(),
      modified: new Date(),
      relativePath: 'char-1/char-1.md',
      filePath: '/test/project/characters/char-1/char-1.md'
    };
    (characterService as any).charactersSubject.next([character]);

    // Count references
    const counts = await characterService.countCharacterReferences('char-1');

    // Should find the character in the pinboard
    expect(counts.pinboards.length).toBe(1);
    expect(counts.pinboards[0].name).toBe('Test Pinboard');
  });

  it('should remove character nodes and edges from pinboards through real services', async () => {
    // Set up a character in the service
    const character: Character = {
      id: 'char-1',
      name: 'Character 1',
      category: 'main',
      tags: [],
      books: [],
      prompts: [],
      content: '',
      created: new Date(),
      modified: new Date(),
      relativePath: 'char-1/char-1.md',
      filePath: '/test/project/characters/char-1/char-1.md'
    };
    (characterService as any).charactersSubject.next([character]);

    // Delete the character
    await characterService.deleteCharacter('char-1');

    // Verify pinboard was updated
    expect(projectService.updatePinboardById).toHaveBeenCalled();
    const updateCall = (projectService.updatePinboardById as jasmine.Spy).calls.mostRecent();
    const updatedPinboard = updateCall.args[1];

    // Character node should be removed
    expect(updatedPinboard.nodes.find((n: any) => n.id === 'char-1')).toBeUndefined();
    // Edge referencing the character should be removed
    expect(updatedPinboard.edges.find((e: any) => e.source === 'char-1' || e.target === 'char-1')).toBeUndefined();
    // Other nodes should remain
    expect(updatedPinboard.nodes.find((n: any) => n.id === 'char-2')).toBeDefined();
  });

});

describe('Delete Confirmation Message Formatting', () => {
  it('should format reference list with counts and names', () => {
    const formatList = (items: { id: string; name: string }[], singularLabel: string, pluralLabel: string, maxShow: number = 3): string => {
      if (items.length === 0) return '';
      const count = items.length;
      const names = items.slice(0, maxShow).map(item => item.name).join(', ');
      const more = count > maxShow ? ` +${count - maxShow} more` : '';
      const label = count === 1 ? singularLabel : pluralLabel;
      return `${count} ${label}: ${names}${more}`;
    };

    const singleHouse = [{ id: 'h1', name: 'House Stark' }];
    expect(formatList(singleHouse, 'house', 'houses')).toBe('1 house: House Stark');

    const twoHouses = [{ id: 'h1', name: 'House Stark' }, { id: 'h2', name: 'House Tully' }];
    expect(formatList(twoHouses, 'house', 'houses')).toBe('2 houses: House Stark, House Tully');

    const fiveHouses = [
      { id: 'h1', name: 'House Stark' },
      { id: 'h2', name: 'House Tully' },
      { id: 'h3', name: 'House Lannister' },
      { id: 'h4', name: 'House Baratheon' },
      { id: 'h5', name: 'House Targaryen' }
    ];
    expect(formatList(fiveHouses, 'house', 'houses')).toBe('5 houses: House Stark, House Tully, House Lannister +2 more');

    const empty: { id: string; name: string }[] = [];
    expect(formatList(empty, 'house', 'houses')).toBe('');
  });

  it('should build complete confirmation message with all reference types', () => {
    const refs = {
      houses: [{ id: 'h1', name: 'House Stark' }],
      casts: [{ id: 'c1', name: 'Main Cast' }, { id: 'c2', name: 'Supporting Cast' }],
      pinboards: [{ id: 'pb1', name: 'Relationships' }],
      plotBoards: []
    };

    const formatList = (items: { id: string; name: string }[], singularLabel: string, pluralLabel: string, maxShow: number = 3): string => {
      if (items.length === 0) return '';
      const count = items.length;
      const names = items.slice(0, maxShow).map(item => item.name).join(', ');
      const more = count > maxShow ? ` +${count - maxShow} more` : '';
      const label = count === 1 ? singularLabel : pluralLabel;
      return `${count} ${label}: ${names}${more}`;
    };

    const refParts: string[] = [];
    if (refs.houses.length > 0) refParts.push(formatList(refs.houses, 'house', 'houses'));
    if (refs.casts.length > 0) refParts.push(formatList(refs.casts, 'cast', 'casts'));
    if (refs.pinboards.length > 0) refParts.push(formatList(refs.pinboards, 'pinboard', 'pinboards'));
    if (refs.plotBoards.length > 0) refParts.push(formatList(refs.plotBoards, 'plot board', 'plot boards'));

    expect(refParts).toEqual([
      '1 house: House Stark',
      '2 casts: Main Cast, Supporting Cast',
      '1 pinboard: Relationships'
    ]);

    const message = `This character will be removed from:\n• ${refParts.join('\n• ')}`;
    expect(message).toContain('1 house: House Stark');
    expect(message).toContain('2 casts: Main Cast, Supporting Cast');
    expect(message).toContain('1 pinboard: Relationships');
  });

  it('should handle case where character has no references', () => {
    const refs = {
      houses: [],
      casts: [],
      pinboards: [],
      plotBoards: []
    };

    const formatList = (items: { id: string; name: string }[], singularLabel: string, pluralLabel: string, maxShow: number = 3): string => {
      if (items.length === 0) return '';
      const count = items.length;
      const names = items.slice(0, maxShow).map(item => item.name).join(', ');
      const more = count > maxShow ? ` +${count - maxShow} more` : '';
      const label = count === 1 ? singularLabel : pluralLabel;
      return `${count} ${label}: ${names}${more}`;
    };

    const refParts: string[] = [];
    if (refs.houses.length > 0) refParts.push(formatList(refs.houses, 'house', 'houses'));
    if (refs.casts.length > 0) refParts.push(formatList(refs.casts, 'cast', 'casts'));
    if (refs.pinboards.length > 0) refParts.push(formatList(refs.pinboards, 'pinboard', 'pinboards'));
    if (refs.plotBoards.length > 0) refParts.push(formatList(refs.plotBoards, 'plot board', 'plot boards'));

    expect(refParts.length).toBe(0);
  });
});
