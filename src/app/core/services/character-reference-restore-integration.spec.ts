import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { ReferenceCleanupService } from './reference-cleanup.service';
import { HouseService } from './house.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { PinboardService } from './pinboard.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteService } from './undo-delete.service';
import { CastEditorSessionService } from './cast-editor-session.service';
import { CharacterService } from './character.service';
import { Project } from '../interfaces/project.interface';

/**
 * Real-DI cleanup → restore round-trip (Part 2 AC).
 */
describe('Character reference restore integration (Real DI)', () => {
  let cleanup: ReferenceCleanupService;
  let houseService: HouseService;
  let castService: CastService;
  let metadataService: MetadataService;
  let pinboardService: PinboardService;
  let plotBoardService: PlotBoardService;
  let projectService: any;
  let project$: BehaviorSubject<Project | null>;
  let disk: Map<string, string>;
  let folders: Set<string>;

  const PROJECT_PATH = '/test/project';

  function createProject(): Project {
    return {
      path: PROJECT_PATH,
      metadata: {
        projectName: 'Test',
        version: '1.0.0',
        categories: [{ id: 'main', name: 'Main', color: '#f00' }],
        tags: [],
        casts: [],
        books: [
          {
            id: 'n26',
            name: 'Book 26',
            color: '#0f0',
            povCharacterIds: ['keep', 'char-1', 'after'],
          },
        ],
        settings: { defaultCategory: 'main' },
        pinboards: [
          {
            id: 'pb-1',
            name: 'Main Board',
            nodes: [
              { id: 'char-1', name: 'Ada', position: { x: 1, y: 2 } },
              { id: 'char-2', name: 'Ben', position: { x: 3, y: 4 } },
            ],
            edges: [
              {
                id: 'e1',
                source: 'char-1',
                target: 'char-2',
                type: 'relationship',
                label: 'knows',
                color: '#000',
              },
            ],
          },
        ],
      },
    };
  }

  beforeEach(() => {
    disk = new Map();
    folders = new Set();
    project$ = new BehaviorSubject<Project | null>(createProject());

    const electron = jasmine.createSpyObj('ElectronService', [
      'isElectron',
      'fileExists',
      'createDirectory',
      'readDirectoryRecursive',
      'readDirectoryFiles',
      'readFile',
      'writeFileAtomic',
      'deleteFile',
      'deleteDirectoryRecursive',
      'stageForTrash',
      'getImageAsDataUrl',
    ]);
    electron.isElectron.and.returnValue(true);
    electron.stageForTrash.and.callFake(async (_p: string, target: string) => {
      disk.delete(target);
      folders.delete(target);
      for (const key of [...disk.keys()]) {
        if (key.startsWith(target + '/')) disk.delete(key);
      }
      return { success: true, token: 'tok-restore-int', expiresAt: Date.now() + 15000 };
    });
    electron.deleteDirectoryRecursive.and.returnValue(Promise.resolve({ success: true }));
    electron.fileExists.and.callFake(
      async (path: string) => disk.has(path) || folders.has(path)
    );
    electron.createDirectory.and.callFake(async (path: string) => {
      folders.add(path);
      return { success: true };
    });
    electron.readDirectoryRecursive.and.callFake(async (path: string) => {
      const files = [...disk.keys()]
        .filter((file) => file.startsWith(path + '/') && (file.endsWith('.md') || file.endsWith('.plotboard.md') || file.endsWith('.pinboard.md')))
        .map((file) => ({
          absolutePath: file,
          relativePath: file.slice(path.length + 1),
        }));
      // Also include plot boards at project root when scanning project path.
      if (path === PROJECT_PATH) {
        return {
          success: true,
          files: [...disk.keys()]
            .filter((file) => file.endsWith('.plotboard.md') || file.endsWith('.pinboard.md'))
            .map((file) => ({
              absolutePath: file,
              relativePath: file.slice(PROJECT_PATH.length + 1),
            })),
        };
      }
      return { success: true, files };
    });
    electron.readDirectoryFiles.and.returnValue(
      Promise.resolve({ success: true, files: [], directories: [] })
    );
    electron.readFile.and.callFake(async (path: string) =>
      disk.has(path)
        ? { success: true, content: disk.get(path) }
        : { success: false, error: 'Missing file' }
    );
    electron.writeFileAtomic.and.callFake(async (path: string, raw: string) => {
      disk.set(path, raw);
      return { success: true };
    });
    electron.deleteFile.and.callFake(async (path: string) => {
      disk.delete(path);
      return { success: true };
    });
    electron.getImageAsDataUrl.and.resolveTo(null);

    projectService = {
      currentProject$: project$,
      getCurrentProject: () => project$.value,
      getCurrentPinboard: () => project$.value?.metadata.pinboards?.[0] || null,
      getPinboards: () => project$.value?.metadata.pinboards || [],
      getCastsFolderPath: () => `${PROJECT_PATH}/casts`,
      getCharactersFolderPath: () => `${PROJECT_PATH}/characters`,
      getDefaultCharacterStyle: () => 'default',
      getCharacterStyles: () => [{ id: 'default', name: 'Default' }],
      remapCharacterIds: jasmine.createSpy('remapCharacterIds').and.returnValue(Promise.resolve(false)),
      updateProject: jasmine.createSpy('updateProject').and.returnValue(Promise.resolve()),
      updateMetadata: jasmine.createSpy('updateMetadata').and.callFake(async (metadata: any) => {
        const project = project$.value!;
        project.metadata = { ...project.metadata, ...metadata };
        project$.next({ ...project });
      }),
      updatePinboardById: jasmine
        .createSpy('updatePinboardById')
        .and.callFake(async (id: string, data: { nodes: any[]; edges: any[] }) => {
          const project = project$.value!;
          project.metadata.pinboards = (project.metadata.pinboards || []).map((board) =>
            board.id === id ? { ...board, nodes: data.nodes, edges: data.edges } : board
          );
          project$.next({ ...project });
        }),
      restorePinboard: jasmine.createSpy('restorePinboard').and.returnValue(Promise.resolve()),
    };

    TestBed.configureTestingModule({
      providers: [
        ReferenceCleanupService,
        HouseService,
        PlotBoardService,
        CastService,
        MetadataService,
        PinboardService,
        CharacterService,
        { provide: ElectronService, useValue: electron },
        {
          provide: FileWatcherService,
          useValue: { fileChanges$: new Subject() },
        },
        {
          provide: LoggingService,
          useValue: jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']),
        },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['showError', 'showUndo', 'dismiss']),
        },
        {
          provide: UndoDeleteService,
          useValue: jasmine.createSpyObj('UndoDeleteService', ['register', 'dismissAll']),
        },
        {
          provide: CastEditorSessionService,
          useValue: { changes$: new BehaviorSubject(null) },
        },
        { provide: ProjectService, useValue: projectService },
      ],
    });

    cleanup = TestBed.inject(ReferenceCleanupService);
    houseService = TestBed.inject(HouseService);
    castService = TestBed.inject(CastService);
    metadataService = TestBed.inject(MetadataService);
    pinboardService = TestBed.inject(PinboardService);
    plotBoardService = TestBed.inject(PlotBoardService);

    (metadataService as any).metadataSubject.next(structuredClone(project$.value!.metadata));
  });

  it('cleanup → restore returns house, pinboard, plot thread, cast and PoV to pre-delete content', async () => {
    const house = await houseService.createHouse({
      name: 'House Stark',
      motto: 'Winter',
      colors: ['#ffffff'],
      characterIds: ['char-1', 'char-2'],
      leadership: [
        { id: 'reign-1', characterIds: ['char-1'], period: 'Y1', books: [], notes: 'note' },
      ],
      currentLeadershipId: 'reign-1',
      content: 'body',
    });
    const houseBefore = structuredClone(houseService.getById(house.id)!);

    // Real casts.json write path: seed index + folder, spy only loadCasts.
    const castsFolder = `${PROJECT_PATH}/casts`;
    const castFolder = `${castsFolder}/main`;
    folders.add(castsFolder);
    folders.add(castFolder);
    const castsJsonPath = `${castsFolder}/casts.json`;
    const castEntry = {
      id: 'cast-1',
      name: 'Main Cast',
      characterIds: ['x', 'char-1', 'y'],
    };
    disk.set(
      castsJsonPath,
      JSON.stringify({ version: 1, casts: [castEntry] }, null, 2)
    );
    (castService as any).castsSubject.next([
      {
        ...castEntry,
        folderPath: castFolder,
      },
    ]);
    (castService as any).hasLoadedForCurrentProject = true;
    (castService as any).currentProjectPath = PROJECT_PATH;
    spyOn(castService as any, 'loadCasts').and.returnValue(Promise.resolve());

    const plotPath = `${PROJECT_PATH}/arc.plotboard.md`;
    // Canonicalize through generateFile so cleanup→restore can match byte-for-byte.
    const plotBefore = plotBoardService.generateFile(
      plotBoardService.parseFile(`---
threads:
  - id: t1
    name: Thread One
    characters:
      - keep
      - char-1
      - after
---
`)
    );
    disk.set(plotPath, plotBefore);

    const pinboardBefore = structuredClone(project$.value!.metadata.pinboards![0]);
    const booksBefore = structuredClone((metadataService as any).metadataSubject.value.books);
    const castBefore = structuredClone((castService as any).castsSubject.value[0].characterIds);
    const castsJsonBefore = disk.get(castsJsonPath)!;

    // Casts keep this runnable on 6a214e3 (void cleanup / missing restore) so ACs fail by assertion.
    const snapshot = (await cleanup.removeCharacterReferences('char-1')) as any;
    expect(snapshot?.houses?.removals?.length).toBe(1);
    expect(snapshot?.pinboards?.removals?.length).toBe(1);
    expect(snapshot?.plotThreads?.removals?.length).toBe(1);
    expect(snapshot?.casts?.removals?.[0]?.index).toBe(1);
    expect(snapshot?.bookPovs?.removals?.[0]?.index).toBe(1);

    expect(typeof (cleanup as any).restoreCharacterReferences).toBe('function');
    const restore = await (cleanup as any).restoreCharacterReferences(snapshot);
    expect(restore.skipped).toEqual([]);
    expect(restore.restored).toBeGreaterThan(0);

    // House update() bumps `modified`, so compare domain fields (not raw bytes).
    const houseAfter = houseService.getById(house.id)!;
    expect(houseAfter.characterIds).toEqual(houseBefore.characterIds);
    expect(houseAfter.leadership).toEqual(houseBefore.leadership);
    expect(houseAfter.currentLeadershipId).toBe(houseBefore.currentLeadershipId);
    expect(houseAfter.content).toBe(houseBefore.content);

    const pinboardAfter = projectService.getPinboards()[0];
    expect(pinboardAfter.nodes).toEqual(pinboardBefore.nodes);
    expect(pinboardAfter.edges).toEqual(pinboardBefore.edges);

    expect(disk.get(plotPath)).toBe(plotBefore);
    expect((castService as any).castsSubject.value[0].characterIds).toEqual(castBefore);
    expect(disk.get(castsJsonPath)).toBe(castsJsonBefore);
    expect((metadataService as any).metadataSubject.value.books).toEqual(booksBefore);
  });

  it('restore with one target deleted reports that skip and restores the rest', async () => {
    const house = await houseService.createHouse({
      name: 'House Keep',
      motto: '',
      colors: [],
      characterIds: ['char-1'],
      leadership: [],
      content: '',
    });

    const castsFolder = `${PROJECT_PATH}/casts`;
    const castFolder = `${castsFolder}/main`;
    folders.add(castsFolder);
    folders.add(castFolder);
    disk.set(
      `${castsFolder}/casts.json`,
      JSON.stringify(
        { version: 1, casts: [{ id: 'cast-1', name: 'Main Cast', characterIds: ['char-1'] }] },
        null,
        2
      )
    );
    (castService as any).castsSubject.next([
      {
        id: 'cast-1',
        name: 'Main Cast',
        characterIds: ['char-1'],
        folderPath: castFolder,
      },
    ]);
    (castService as any).hasLoadedForCurrentProject = true;
    (castService as any).currentProjectPath = PROJECT_PATH;
    spyOn(castService as any, 'loadCasts').and.returnValue(Promise.resolve());

    const plotPath = `${PROJECT_PATH}/arc.plotboard.md`;
    disk.set(
      plotPath,
      plotBoardService.generateFile(
        plotBoardService.parseFile(`---
threads:
  - id: t1
    name: Thread One
    characters:
      - char-1
---
`)
      )
    );

    const snapshot = (await cleanup.removeCharacterReferences('char-1')) as any;
    const pinboardAfterCleanup = structuredClone(projectService.getPinboards()[0]);
    expect(pinboardAfterCleanup.nodes.find((n: any) => n.id === 'char-1')).toBeUndefined();

    await houseService.deleteHouse(house.id, houseService.getById(house.id)!.raw);
    expect(houseService.getById(house.id)).toBeUndefined();

    expect(typeof (cleanup as any).restoreCharacterReferences).toBe('function');
    const restore = await (cleanup as any).restoreCharacterReferences(snapshot);
    expect(restore.skipped).toEqual([
      { kind: 'house', id: house.id, label: 'House Keep' },
    ]);
    expect((castService as any).castsSubject.value[0].characterIds).toContain('char-1');
    expect(
      (metadataService as any).metadataSubject.value.books[0].povCharacterIds
    ).toContain('char-1');
    expect(projectService.getPinboards()[0].nodes.some((n: any) => n.id === 'char-1')).toBeTrue();
    expect(disk.get(plotPath)).toContain('char-1');
  });
});
