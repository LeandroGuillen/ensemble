import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { ProjectService } from './project.service';
import { WorldMapService } from './world-map.service';
import { parseWorldMap, setPinPosition } from '../utils/world-map.utils';

const PROJECT = '/vault';
const MAP_PATH = `${PROJECT}/world-map.md`;

describe('WorldMapService', () => {
  let service: WorldMapService;
  let electron: jasmine.SpyObj<ElectronService>;
  let fileChanges: Subject<FileChangeEvent>;
  let project$: BehaviorSubject<any>;
  let disk: string | null;
  let writable: boolean;

  beforeEach(() => {
    disk = null;
    writable = true;
    fileChanges = new Subject<FileChangeEvent>();
    electron = jasmine.createSpyObj('ElectronService', ['fileExists', 'readFile', 'writeFileAtomic', 'isWritable']);
    electron.fileExists.and.callFake(async () => disk !== null);
    electron.readFile.and.callFake(async () =>
      disk === null ? { success: false, error: 'ENOENT' } : { success: true, content: disk }
    );
    electron.writeFileAtomic.and.callFake(async (_path: string, content: string) => {
      if (!writable) return { success: false, error: 'EACCES: permission denied' };
      disk = content;
      return { success: true };
    });
    electron.isWritable.and.callFake(async () => writable);
    project$ = new BehaviorSubject<any>({ path: PROJECT, metadata: {} });

    TestBed.configureTestingModule({
      providers: [
        WorldMapService,
        { provide: ElectronService, useValue: electron },
        { provide: ProjectService, useValue: { currentProject$: project$ } },
        {
          provide: LocationService,
          useValue: { getLocationsSnapshot: () => [{ id: 'a1', name: 'Grey Harbor' }] },
        },
        { provide: FileWatcherService, useValue: { fileChanges$: fileChanges.asObservable() } },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error', 'log']) },
      ],
    });
    service = TestBed.inject(WorldMapService);
  });

  it('starts empty and editable when the project has no world-map.md, without creating it', async () => {
    await service.load();
    expect(service.snapshot?.map.pins).toEqual([]);
    expect(service.snapshot?.readOnly).toBeFalse();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('saves a dragged pin to world-map.md and reads it back after reopening', async () => {
    await service.load();
    expect(await service.apply(setPinPosition(service.snapshot!.map, 'a1', 120, -40))).toBeTrue();

    expect(electron.writeFileAtomic).toHaveBeenCalledWith(MAP_PATH, jasmine.any(String));
    expect(disk).toContain('name: Grey Harbor');
    expect(parseWorldMap(disk!).map.pins).toEqual([{ locationId: 'a1', x: 120, y: -40 }]);

    // Reopen: a fresh project load reads the saved positions.
    project$.next(null);
    project$.next({ path: PROJECT, metadata: {} });
    expect(service.snapshot).toBeNull();
    await service.load();
    expect(service.snapshot?.map.pins).toEqual([{ locationId: 'a1', x: 120, y: -40 }]);
  });

  it('undoes and redoes edits, writing each step', async () => {
    await service.load();
    await service.apply(setPinPosition(service.snapshot!.map, 'a1', 10, 10));
    await service.apply(setPinPosition(service.snapshot!.map, 'a1', 50, 50));
    expect(service.snapshot?.canUndo).toBeTrue();

    await service.undo();
    expect(parseWorldMap(disk!).map.pins).toEqual([{ locationId: 'a1', x: 10, y: 10 }]);
    expect(service.snapshot?.canRedo).toBeTrue();

    await service.redo();
    expect(parseWorldMap(disk!).map.pins).toEqual([{ locationId: 'a1', x: 50, y: 50 }]);
    expect(service.snapshot?.canRedo).toBeFalse();
  });

  it('keeps the map read-only when project metadata is protected even if the map file is writable', async () => {
    project$.next({ path: PROJECT, metadata: {}, readOnly: true });
    disk = '---\npins: []\nroads: []\n---\nMap notes';
    await service.load();
    expect(service.snapshot?.readOnly).toBeTrue();
    expect(service.snapshot?.map.notes).toContain('Map notes');
    expect(await service.apply(setPinPosition(service.snapshot!.map, 'a1', 1, 1))).toBeFalse();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('marks a read-only project and refuses edits', async () => {
    writable = false;
    await service.load();
    expect(service.snapshot?.readOnly).toBeTrue();
    expect(await service.apply(setPinPosition(service.snapshot!.map, 'a1', 1, 1))).toBeFalse();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('puts the previous map back when a save fails, and switches to read-only if the folder is not writable', async () => {
    await service.load();
    writable = false;
    expect(await service.apply(setPinPosition(service.snapshot!.map, 'a1', 1, 1))).toBeFalse();
    expect(service.snapshot?.map.pins).toEqual([]);
    expect(service.snapshot?.readOnly).toBeTrue();
    expect(service.snapshot?.canUndo).toBeFalse();
    expect(service.lastError).toContain('EACCES');
  });

  it('does not overwrite a world-map.md it cannot parse', async () => {
    disk = '---\npins: [\n---\n';
    await service.load();
    expect(service.snapshot?.error).toBeTruthy();
    expect(await service.apply(setPinPosition(service.snapshot!.map, 'a1', 1, 1))).toBeFalse();
    expect(disk).toBe('---\npins: [\n---\n');
  });

  it('reloads on an external edit but ignores the echo of its own write', async () => {
    await service.load();
    await service.apply(setPinPosition(service.snapshot!.map, 'a1', 10, 10));
    electron.readFile.calls.reset();

    fileChanges.next({ type: 'change', path: MAP_PATH, filename: 'world-map.md' });
    await new Promise((r) => setTimeout(r));
    expect(service.snapshot?.canUndo).toBeTrue(); // own write: no reload, history kept

    disk = '---\npins:\n  - location: a1\n    x: 99\n    y: 1\n---\n';
    fileChanges.next({ type: 'change', path: MAP_PATH, filename: 'world-map.md' });
    await new Promise((r) => setTimeout(r));
    await new Promise((r) => setTimeout(r));
    expect(service.snapshot?.map.pins).toEqual([{ locationId: 'a1', x: 99, y: 1 }]);
    expect(service.snapshot?.canUndo).toBeFalse();
  });
});
