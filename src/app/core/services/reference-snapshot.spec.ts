import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { HouseService } from './house.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { PinboardService } from './pinboard.service';
import { PlotBoardService } from './plot-board.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { CastEditorSessionService } from './cast-editor-session.service';
import { CharacterService } from './character.service';
import { Project } from '../interfaces/project.interface';

/**
 * Unit specs asserting typed snapshot contents from each cleanup method (Part 2 AC).
 */
describe('Reference cleanup snapshots', () => {
  describe('HouseService snapshots', () => {
    let service: HouseService;
    let disk: Map<string, string>;
    let folders: Set<string>;
    let project$: BehaviorSubject<any>;

    beforeEach(() => {
      disk = new Map();
      folders = new Set();
      project$ = new BehaviorSubject({ path: '/project', metadata: { books: [] } });
      const electron = jasmine.createSpyObj('ElectronService', [
        'fileExists',
        'createDirectory',
        'readDirectoryRecursive',
        'readFile',
        'writeFileAtomic',
        'deleteFile',
        'getImageAsDataUrl',
      ]);
      electron.fileExists.and.callFake(
        async (path: string) => disk.has(path) || folders.has(path)
      );
      electron.createDirectory.and.callFake(async (path: string) => {
        folders.add(path);
        return { success: true };
      });
      electron.readDirectoryRecursive.and.callFake(async (path: string) => ({
        success: true,
        files: [...disk.keys()]
          .filter((file) => file.startsWith(path + '/') && file.endsWith('.md'))
          .map((file) => ({
            absolutePath: file,
            relativePath: file.slice(path.length + 1),
          })),
      }));
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

      TestBed.configureTestingModule({
        providers: [
          HouseService,
          { provide: ElectronService, useValue: electron },
          {
            provide: ProjectService,
            useValue: {
              currentProject$: project$,
              getCurrentProject: () => project$.value,
            },
          },
          {
            provide: FileWatcherService,
            useValue: { fileChanges$: new Subject() },
          },
          {
            provide: LoggingService,
            useValue: jasmine.createSpyObj('LoggingService', ['error']),
          },
        ],
      });
      service = TestBed.inject(HouseService);
    });

    it('house snapshot captures membership, leadership, currentLeadershipId and pruned reigns across 2 houses', async () => {
      const houseA = await service.createHouse({
        name: 'House Stark',
        motto: '',
        colors: [],
        characterIds: ['char-1', 'char-2'],
        leadership: [
          { id: 'reign-solo', characterIds: ['char-1'], period: 'Y1', books: [], notes: '' },
          {
            id: 'reign-shared',
            characterIds: ['char-1', 'char-2'],
            period: 'Y2',
            books: [],
            notes: '',
          },
        ],
        currentLeadershipId: 'reign-solo',
        content: '',
      });
      const houseB = await service.createHouse({
        name: 'House Tully',
        motto: '',
        colors: [],
        characterIds: ['char-1'],
        leadership: [],
        content: '',
      });

      // `as any` so void returns on 6a214e3 fail by assertion, not compile.
      const snapshot = (await service.removeCharacterFromHouses('char-1')) as any;

      expect(snapshot?.removals?.length).toBe(2);
      const stark = snapshot.removals.find((r: any) => r.houseId === houseA.id)!;
      expect(stark.characterIds).toEqual(['char-1', 'char-2']);
      expect(stark.currentLeadershipId).toBe('reign-solo');
      expect(stark.leadership.length).toBe(2);
      expect(stark.prunedReigns.map((r: any) => r.id)).toEqual(['reign-solo']);
      expect(stark.prunedReigns[0].characterIds).toEqual(['char-1']);

      const tully = snapshot.removals.find((r: any) => r.houseId === houseB.id)!;
      expect(tully.characterIds).toEqual(['char-1']);
    });

    it('location seatId snapshot captures prior seat references', async () => {
      const house = await service.createHouse({
        name: 'House Seat',
        motto: '',
        colors: [],
        seatId: 'loc-harbour',
        characterIds: [],
        leadership: [],
        content: '',
      });

      const snapshot = (await service.clearLocationReferences('loc-harbour')) as any;
      expect(snapshot?.seats).toEqual([
        { houseId: house.id, houseName: 'House Seat', seatId: 'loc-harbour' },
      ]);
    });

    it('house restore re-adds only the undone character (does not revive a later-deleted peer)', async () => {
      const house = await service.createHouse({
        name: 'House Shared',
        motto: '',
        colors: [],
        characterIds: ['char-1', 'char-2'],
        leadership: [
          { id: 'r1', characterIds: ['char-1', 'char-2'], period: 'Y1', books: [], notes: '' },
        ],
        currentLeadershipId: 'r1',
        content: '',
      });

      const snap1 = (await service.removeCharacterFromHouses('char-1')) as any;
      expect(service.getById(house.id)!.characterIds).toEqual(['char-2']);
      expect(service.getById(house.id)!.leadership[0].characterIds).toEqual(['char-2']);

      await service.removeCharacterFromHouses('char-2');
      expect(service.getById(house.id)!.characterIds).toEqual([]);
      expect(service.getById(house.id)!.leadership).toEqual([]);

      await (service as any).restoreCharacterToHouses(snap1);
      const after = service.getById(house.id)!;
      expect(after.characterIds).toEqual(['char-1']);
      expect(after.leadership).toEqual([
        jasmine.objectContaining({
          id: 'r1',
          characterIds: ['char-1'],
        }),
      ]);
      expect(after.currentLeadershipId).toBe('r1');
    });

    it('house restore does not wipe membership edits made during the Undo window', async () => {
      const house = await service.createHouse({
        name: 'House Edit',
        motto: '',
        colors: [],
        characterIds: ['char-1', 'char-2'],
        leadership: [],
        content: '',
      });

      const snap = (await service.removeCharacterFromHouses('char-1')) as any;
      expect(service.getById(house.id)!.characterIds).toEqual(['char-2']);

      const live = service.getById(house.id)!;
      await service.updateHouse(
        live.id,
        {
          name: live.name,
          motto: live.motto,
          colors: live.colors,
          characterIds: ['char-9'],
          leadership: [],
          content: live.content,
        },
        live.raw
      );
      expect(service.getById(house.id)!.characterIds).toEqual(['char-9']);

      await (service as any).restoreCharacterToHouses(snap);
      // Re-inserts char-1 at its prior index (0) without wiping char-9.
      expect(service.getById(house.id)!.characterIds).toEqual(['char-1', 'char-9']);
    });

    it('location seat restore leaves a newer seatId alone', async () => {
      const house = await service.createHouse({
        name: 'House Seat2',
        motto: '',
        colors: [],
        seatId: 'loc-old',
        characterIds: [],
        leadership: [],
        content: '',
      });
      const snap = (await service.clearLocationReferences('loc-old')) as any;
      expect(service.getById(house.id)!.seatId).toBeUndefined();

      const live = service.getById(house.id)!;
      await service.updateHouse(
        live.id,
        {
          name: live.name,
          motto: live.motto,
          colors: live.colors,
          seatId: 'loc-new',
          characterIds: [],
          leadership: [],
          content: live.content,
        },
        live.raw
      );

      await (service as any).restoreLocationReferences(snap);
      expect(service.getById(house.id)!.seatId).toBe('loc-new');
    });
  });

  describe('other cleanup snapshots', () => {
    let project$: BehaviorSubject<Project | null>;
    let electron: jasmine.SpyObj<ElectronService>;
    let castService: CastService;
    let metadataService: MetadataService;
    let pinboardService: PinboardService;
    let plotBoardService: PlotBoardService;
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
              povCharacterIds: ['other', 'char-1', 'later'],
            },
          ],
          settings: { defaultCategory: 'main' },
          pinboards: [
            {
              id: 'pb-1',
              name: 'Main Board',
              nodes: [
                { id: 'char-1', name: 'Ada', position: { x: 10, y: 20 } },
                { id: 'char-2', name: 'Ben', position: { x: 30, y: 40 } },
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
      project$ = new BehaviorSubject<Project | null>(createProject());
      electron = jasmine.createSpyObj('ElectronService', [
        'isElectron',
        'fileExists',
        'createDirectory',
        'readDirectoryRecursive',
        'readDirectoryFiles',
        'readFile',
        'writeFileAtomic',
        'deleteFile',
        'getImageAsDataUrl',
      ]);
      electron.isElectron.and.returnValue(true);
      electron.fileExists.and.returnValue(Promise.resolve(false));
      electron.createDirectory.and.returnValue(Promise.resolve({ success: true }));
      electron.readDirectoryRecursive.and.returnValue(
        Promise.resolve({ success: true, files: [] })
      );
      electron.readDirectoryFiles.and.returnValue(
        Promise.resolve({ success: true, files: [], directories: [] })
      );
      electron.readFile.and.returnValue(Promise.resolve({ success: false, error: 'missing' }));
      electron.writeFileAtomic.and.returnValue(Promise.resolve({ success: true }));
      electron.deleteFile.and.returnValue(Promise.resolve({ success: true }));
      electron.getImageAsDataUrl.and.returnValue(Promise.resolve(null));

      TestBed.configureTestingModule({
        providers: [
          CastService,
          MetadataService,
          PinboardService,
          PlotBoardService,
          { provide: ElectronService, useValue: electron },
          {
            provide: FileWatcherService,
            useValue: jasmine.createSpyObj('FileWatcherService', [], {
              fileChanges$: new BehaviorSubject(null),
            }),
          },
          {
            provide: LoggingService,
            useValue: jasmine.createSpyObj('LoggingService', ['log', 'error', 'warn']),
          },
          {
            provide: CastEditorSessionService,
            useValue: { changes$: new BehaviorSubject(null) },
          },
          {
            provide: CharacterService,
            useValue: jasmine.createSpyObj('CharacterService', ['getCharacterById']),
          },
          {
            provide: ProjectService,
            useValue: {
              currentProject$: project$,
              getCurrentProject: () => project$.value,
              getCurrentPinboard: () => project$.value?.metadata.pinboards?.[0] || null,
              getPinboards: () => project$.value?.metadata.pinboards || [],
              getCastsFolderPath: () => `${PROJECT_PATH}/casts`,
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
            },
          },
        ],
      });

      castService = TestBed.inject(CastService);
      metadataService = TestBed.inject(MetadataService);
      pinboardService = TestBed.inject(PinboardService);
      plotBoardService = TestBed.inject(PlotBoardService);
      (metadataService as any).metadataSubject.next(project$.value!.metadata);
    });

    it('pinboard snapshot captures removed nodes and edges', async () => {
      const snapshot = (await pinboardService.removeCharacterConnections('char-1')) as any;
      expect(snapshot?.removals?.length).toBe(1);
      expect(snapshot.removals[0].nodes).toEqual([
        { id: 'char-1', name: 'Ada', position: { x: 10, y: 20 } },
      ]);
      expect(snapshot.removals[0].nodeIndexes).toEqual([0]);
      expect(snapshot.removals[0].edges.length).toBe(1);
      expect(snapshot.removals[0].edges[0].id).toBe('e1');
      expect(snapshot.removals[0].edgeIndexes).toEqual([0]);
    });

    it('cast snapshot captures membership index', async () => {
      (castService as any).castsSubject.next([
        {
          id: 'cast-1',
          name: 'Main Cast',
          characterIds: ['a', 'b', 'char-1', 'd'],
          folderPath: `${PROJECT_PATH}/casts/main-cast`,
        },
      ]);
      (castService as any).hasLoadedForCurrentProject = true;
      (castService as any).currentProjectPath = PROJECT_PATH;
      spyOn(castService as any, 'loadCasts').and.returnValue(Promise.resolve());
      spyOn(castService, 'updateCast').and.callFake(async (id, data) => {
        const casts = (castService as any).castsSubject.value.map((c: any) =>
          c.id === id ? { ...c, ...data } : c
        );
        (castService as any).castsSubject.next(casts);
        return casts.find((c: any) => c.id === id);
      });

      const snapshot = (await castService.removeCharacterFromCasts('char-1')) as any;
      expect(snapshot?.removals).toEqual([
        { castId: 'cast-1', castName: 'Main Cast', index: 2 },
      ]);
    });

    it('book PoV snapshot captures index in povCharacterIds', async () => {
      const snapshot = (await metadataService.removeCharacterFromBookPovs('char-1')) as any;
      expect(snapshot?.removals).toEqual([
        { bookId: 'n26', bookName: 'Book 26', index: 1 },
      ]);
    });

    it('plot thread snapshot captures board path, thread id and index', async () => {
      const boardContent = `---
threads:
  - id: t1
    name: Thread One
    characters:
      - other
      - char-1
      - later
---
`;
      electron.readDirectoryRecursive.and.returnValues(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: 'arc.plotboard.md',
              absolutePath: `${PROJECT_PATH}/arc.plotboard.md`,
            },
          ],
        }),
        Promise.resolve({ success: true, files: [] })
      );
      electron.readFile.and.returnValue(Promise.resolve({ success: true, content: boardContent }));

      const snapshot = (await plotBoardService.removeCharacterFromThreads('char-1')) as any;
      expect(snapshot?.removals).toEqual([
        {
          boardPath: 'arc.plotboard.md',
          threadId: 't1',
          threadName: 'Thread One',
          index: 1,
        },
      ]);
    });

    it('plot restore reports skips when writeFileAtomic fails (not a false restored count)', async () => {
      const boardContent = `---
threads:
  - id: t1
    name: Thread One
    characters:
      - other
      - later
---
`;
      electron.readDirectoryRecursive.and.returnValue(
        Promise.resolve({
          success: true,
          files: [
            {
              relativePath: 'arc.plotboard.md',
              absolutePath: `${PROJECT_PATH}/arc.plotboard.md`,
            },
          ],
        })
      );
      electron.readFile.and.returnValue(Promise.resolve({ success: true, content: boardContent }));
      electron.writeFileAtomic.and.returnValue(
        Promise.resolve({ success: false, error: 'disk full' })
      );

      const result = await (plotBoardService as any).restoreCharacterToThreads({
        characterId: 'char-1',
        removals: [
          {
            boardPath: 'arc.plotboard.md',
            threadId: 't1',
            threadName: 'Thread One',
            index: 1,
          },
        ],
      });

      expect(result.restored).toBe(0);
      expect(result.skipped).toEqual([
        {
          kind: 'plot-thread',
          id: 'arc.plotboard.md#t1',
          label: 'Thread One',
        },
      ]);
    });
  });
});
