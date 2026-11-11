import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { ProjectService } from './project.service';
import { WorldMapService } from './world-map.service';
import { parseWorldMap, parseWorldMaps, setPinPosition, setLocationArea, removeAreaPin } from '../utils/world-map.utils';

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
    electron = jasmine.createSpyObj('ElectronService', ['fileExists', 'readFile', 'writeFileAtomic', 'isWritable', 'createDirectory', 'saveBase64Image', 'getImageAsDataUrl']);
    electron.createDirectory.and.resolveTo({ success: true });
    electron.saveBase64Image.and.resolveTo({ success: true });
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

  it('persists areas through undo, redo, duplication and reopening', async () => {
    await service.load();
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }];
    await service.apply(setLocationArea(service.snapshot!.map, 'a1', points, '#123456'));
    expect(parseWorldMap(disk!).map.areas![0].points).toEqual(points);
    await service.undo();
    expect(service.snapshot!.map.areas).toBeUndefined();
    await service.redo();
    expect(service.snapshot!.map.areas![0].color).toBe('#123456');
    await service.duplicateMap('world');
    expect(service.snapshot!.map.areas![0].points).toEqual(points);
    expect(service.snapshot!.maps!.length).toBe(2);
    expect(service.snapshot!.maps![0].map.areas).not.toBe(service.snapshot!.map.areas);
    project$.next(null);
    project$.next({ path: PROJECT, metadata: {} });
    await service.load();
    expect(service.snapshot!.maps!.every(entry => entry.map.areas![0].color === '#123456')).toBeTrue();
  });

  it('undoes conversion to an area-only location, restoring its pin and roads', async () => {
    await service.load();
    const map = setLocationArea({ ...service.snapshot!.map,
      pins: [{ locationId: 'a1', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 100 }],
      roads: [{ from: 'a1', to: 'b' }],
    }, 'a1', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]);
    await service.apply(map);
    await service.apply(removeAreaPin(map, 'a1'));
    expect(service.snapshot!.map.pins.length).toBe(1);
    expect(service.snapshot!.map.areas).toEqual(map.areas);
    await service.undo();
    expect(service.snapshot!.map).toEqual(map);
    await service.redo();
    expect(parseWorldMap(disk!).map.pins.length).toBe(1);
    expect(parseWorldMap(disk!).map.areas).toEqual(map.areas);
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
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><path d="M0 0L10 10"/></svg>';

  it('imports a portable asset and keeps pins, roads and notes through replacement and undo', async () => {
    await service.load();
    await service.apply({ pins: [{ locationId: 'a1', x: -20, y: 30 }], roads: [], notes: 'Keep me' });
    const original = service.snapshot!.map;
    expect(await service.importBackground(svg, 'World.svg')).toBeTrue();
    const first = service.snapshot!.map.background!;
    expect(first.file).toMatch(/^assets\/maps\/[^/]+\.svg$/);
    expect(first).toEqual(jasmine.objectContaining({ x: -500, y: -250, width: 1000, height: 500, name: 'World.svg' }));
    expect(electron.writeFileAtomic).toHaveBeenCalledWith(`${PROJECT}/${first.file}`, svg);
    expect(parseWorldMap(disk!).map.background).toEqual(first);
    expect(service.snapshot!.map.pins).toEqual(original.pins);
    await service.importBackground(svg, 'Replacement.svg');
    expect(service.snapshot!.map.background!.file).not.toBe(first.file);
    await service.undo();
    expect(service.snapshot!.map.background).toEqual(first);
    await service.undo();
    expect(service.snapshot!.map).toEqual(original);
    await service.redo();
    expect(service.snapshot!.map.background).toEqual(first);
  });

  it('gives SVGs with tiny viewBoxes a useful initial canvas size', async () => {
    await service.load();
    await service.importBackground('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 0.5"/>', 'Tiny.svg');
    expect(service.snapshot!.map.background).toEqual(jasmine.objectContaining({ width: 1000, height: 500, x: -500, y: -250 }));
  });

  it('does not alter the map when the asset cannot be saved or the upload is invalid', async () => {
    await service.load();
    const original = service.snapshot!.map;
    electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Disk full' });
    await expectAsync(service.importBackground(svg, 'Map.svg')).toBeRejectedWithError('Disk full');
    expect(service.snapshot!.map).toBe(original);
    expect(service.snapshot!.canUndo).toBeFalse();
    await expectAsync(service.importBackground('<html/>', 'Map.svg')).toBeRejected();
    expect(service.snapshot!.map).toBe(original);
  });

  it('refuses imports in read-only projects and discards imports after a project switch', async () => {
    project$.next({ path: PROJECT, readOnly: true });
    await service.load();
    expect(await service.importBackground(svg, 'Map.svg')).toBeFalse();
    expect(electron.createDirectory).not.toHaveBeenCalled();
    project$.next({ path: '/other' });
    await service.load();
    let finish!: (value: { success: boolean }) => void;
    electron.createDirectory.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const importing = service.importBackground(svg, 'Map.svg');
    project$.next({ path: '/third' });
    await service.load();
    finish({ success: true });
    expect(await importing).toBeFalse();
    expect(service.snapshot!.map.background).toBeUndefined();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('loads SVGs only from project-local assets and reports missing images', async () => {
    await service.load();
    await service.importBackground(svg, 'Map.svg');
    const background = service.snapshot!.map.background!;
    electron.readFile.and.resolveTo({ success: true, content: svg });
    expect(await service.backgroundImage(background)).toContain('data:image/svg+xml;');
    expect(electron.readFile).toHaveBeenCalledWith(`${PROJECT}/${background.file}`);
    await expectAsync(service.backgroundImage({ ...background, file: '../../secret.svg' })).toBeRejected();
    electron.readFile.and.resolveTo({ success: false, error: 'ENOENT' });
    await expectAsync(service.backgroundImage(background)).toBeRejectedWithError('ENOENT');
  });

  it('creates empty named maps and keeps locations, roads and backgrounds independent', async () => {
    await service.load();
    await service.apply({ pins: [{ locationId: 'city', x: 12, y: 34 }, { locationId: 'country', x: 50, y: 60 }], roads: [{ from: 'city', to: 'country' }], notes: 'World notes' });
    await service.importBackground(svg, 'World.svg');
    const world = service.snapshot!.map;
    expect(await service.createMap('Capital City')).toBeTrue();
    const cityId = service.snapshot!.activeMapId!;
    expect(service.snapshot!.map.pins).toEqual([]);
    expect(service.snapshot!.map.background).toBeUndefined();
    await service.apply(setPinPosition(service.snapshot!.map, 'city', 900, 100));
    await service.importBackground(svg, 'City.svg');
    const city = service.snapshot!.map;
    expect(city.background!.file).not.toBe(world.background!.file);
    expect(parseWorldMaps(disk!).collection.maps.map(entry => entry.name)).toEqual(['World map', 'Capital City']);
    service.selectMap('world');
    expect(service.snapshot!.map).toEqual(world);
    service.selectMap(cityId);
    expect(service.snapshot!.map).toEqual(city);
  });

  it('switches maps without writes or history entries, remembers selection, and allows read-only browsing', async () => {
    await service.load();
    await service.createMap('City');
    const cityId = service.snapshot!.activeMapId!;
    const writes = electron.writeFileAtomic.calls.count();
    service.selectMap('world');
    expect(service.selectMap('missing')).toBeFalse();
    service.selectMap(cityId);
    expect(electron.writeFileAtomic.calls.count()).toBe(writes);
    await service.load(true);
    expect(service.snapshot!.activeMapId).toBe(cityId);
    expect(service.snapshot!.canUndo).toBeFalse();
    project$.next({ path: PROJECT, readOnly: true });
    await service.load(true);
    expect(service.selectMap('world')).toBeTrue();
    expect(await service.createMap('Another')).toBeFalse();
    expect(await service.renameMap('world', 'Changed')).toBeFalse();
    expect(electron.writeFileAtomic.calls.count()).toBe(writes);
  });

  it('undoes and redoes map creation, renaming and edits across maps', async () => {
    await service.load();
    await service.createMap('City');
    const id = service.snapshot!.activeMapId!;
    await service.renameMap(id, 'Capital');
    await service.apply(setPinPosition(service.snapshot!.map, 'city', 80, 90));
    service.selectMap('world');
    await service.undo();
    expect(service.snapshot!.activeMapId).toBe(id);
    expect(service.snapshot!.map.pins).toEqual([]);
    await service.undo();
    expect(service.snapshot!.maps![1].name).toBe('City');
    await service.undo();
    expect(service.snapshot!.maps!.length).toBe(1);
    expect(service.snapshot!.activeMapId).toBe('world');
    await service.redo();
    await service.redo();
    await service.redo();
    expect(service.snapshot!.maps![1].name).toBe('Capital');
    expect(service.snapshot!.maps![1].map.pins).toEqual([{ locationId: 'city', x: 80, y: 90 }]);
  });

  it('rejects invalid map names and rolls back failed collection writes without losing legacy data', async () => {
    await service.load();
    await service.apply(setPinPosition(service.snapshot!.map, 'city', 12, 34));
    const original = disk;
    expect(await service.createMap('  world MAP  ')).toBeFalse();
    expect(await service.createMap('   ')).toBeFalse();
    expect(await service.createMap('x'.repeat(121))).toBeFalse();
    electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Disk full' });
    expect(await service.createMap('City')).toBeFalse();
    expect(service.snapshot!.maps!.length).toBe(1);
    expect(service.snapshot!.activeMapId).toBe('world');
    expect(disk).toBe(original);
    expect(service.snapshot!.map.pins).toEqual([{ locationId: 'city', x: 12, y: 34 }]);
  });

  it('attaches a background to its original map if selection changes during the import', async () => {
    await service.load();
    await service.createMap('City');
    const cityId = service.snapshot!.activeMapId!;
    let finish!: (value: { success: boolean }) => void;
    electron.createDirectory.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const importing = service.importBackground(svg, 'City.svg');
    service.selectMap('world');
    finish({ success: true });
    expect(await importing).toBeTrue();
    expect(service.snapshot!.activeMapId).toBe('world');
    expect(service.snapshot!.map.background).toBeUndefined();
    expect(service.snapshot!.maps!.find(entry => entry.id === cityId)!.map.background!.name).toBe('City.svg');
  });

  it('protects unsupported collection files from being overwritten', async () => {
    disk = '---\nversion: 99\nmaps: []\n---\nFuture format';
    await service.load();
    expect(service.snapshot!.error).toBeTruthy();
    expect(await service.createMap('City')).toBeFalse();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('persists automatic membership at creation and restores rules through reopen and undo', async () => {
    await service.load();
    const rules = { types: ['country', 'region'], include: ['landmark'], exclude: ['hidden'] };
    await service.createMap('Continent', rules);
    const id = service.snapshot!.activeMapId!;
    expect(service.snapshot!.map.membership).toEqual(rules);
    expect(service.snapshot!.map.pins).toEqual([]);
    expect(parseWorldMaps(disk!).collection.maps[1].map.membership).toEqual(rules);
    await service.apply({ ...service.snapshot!.map, membership: { ...rules, types: ['settlement'] } });
    await service.undo();
    expect(service.snapshot!.map.membership).toEqual(rules);
    await service.load(true);
    expect(service.snapshot!.activeMapId).toBe(id);
    expect(service.snapshot!.map.membership).toEqual(rules);
    expect(service.snapshot!.map.pins).toEqual([]);
  });

  it('duplicates every map setting with independent data and supports undo and redo', async () => {
    await service.load();
    const original = { pins: [{ locationId: 'a', x: 12, y: 34 }, { locationId: 'b', x: 56, y: 78 }], roads: [{ from: 'a', to: 'b', label: 'Coast road' }], notes: 'Map notes',
      background: { file: 'assets/maps/coast.svg', name: 'Coast.svg', x: -500, y: -250, width: 1000, height: 500, opacity: 0.7, visible: false },
      membership: { types: ['country'], include: ['a'], exclude: ['hidden'] } };
    await service.apply(original);
    expect(await service.duplicateMap('world')).toBeTrue();
    const copyId = service.snapshot!.activeMapId!;
    const copy = service.snapshot!.map;
    expect(copyId).not.toBe('world');
    expect(service.snapshot!.maps![1].name).toBe('World map copy');
    expect(copy).toEqual(original);
    expect(copy.pins).not.toBe(original.pins);
    expect(copy.background).not.toBe(original.background);
    expect(copy.membership!.include).not.toBe(original.membership.include);
    expect(parseWorldMaps(disk!).collection.maps[1].map).toEqual(original);
    await service.undo();
    expect(service.snapshot!.maps!.length).toBe(1);
    await service.redo();
    expect(service.snapshot!.activeMapId).toBe(copyId);
    await service.apply(setPinPosition(copy, 'a', 900, 500));
    service.selectMap('world');
    expect(service.snapshot!.map).toEqual(original);
  });

  it('deletes a map, persists the remaining maps and supports undo/redo', async () => {
    await service.load();
    await service.createMap('City');
    const cityId = service.snapshot!.activeMapId!;
    await service.apply(setLocationArea(setPinPosition(service.snapshot!.map, 'a1', 20, 30), 'a1',
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }]));
    const before = structuredClone(service.snapshot!.maps!);
    expect(await service.deleteMap(cityId)).toBeTrue();
    expect(service.snapshot!.maps!.map(map => map.id)).toEqual(['world']);
    expect(service.snapshot!.activeMapId).toBe('world');
    expect(parseWorldMaps(disk!).collection.maps.length).toBe(1);
    await service.undo();
    expect(service.snapshot!.maps).toEqual(before);
    expect(service.snapshot!.activeMapId).toBe(cityId);
    await service.redo();
    expect(service.snapshot!.maps!.length).toBe(1);
    await service.load(true);
    expect(service.snapshot!.maps!.length).toBe(1);
  });

  it('protects the final map and read-only projects, and rolls back failed map deletion', async () => {
    await service.load();
    expect(await service.deleteMap('world')).toBeFalse();
    expect(service.lastError).toContain('at least one');
    expect(await service.deleteMap('missing')).toBeFalse();
    await service.createMap('City');
    const cityId = service.snapshot!.activeMapId!;
    const before = structuredClone(service.snapshot!.maps);
    electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Disk full' });
    expect(await service.deleteMap(cityId)).toBeFalse();
    expect(service.snapshot!.maps).toEqual(before);
    expect(service.snapshot!.activeMapId).toBe(cityId);
    writable = false;
    await service.load(true);
    electron.writeFileAtomic.calls.reset();
    expect(await service.deleteMap(cityId)).toBeFalse();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('uses unique bounded copy names and refuses duplicate writes in read-only projects', async () => {
    await service.load();
    await service.renameMap('world', 'x'.repeat(120));
    await service.duplicateMap('world');
    await service.duplicateMap('world');
    const names = service.snapshot!.maps!.map(entry => entry.name);
    expect(new Set(names).size).toBe(3);
    expect(names[1].endsWith(' copy')).toBeTrue();
    expect(names[2].endsWith(' copy 2')).toBeTrue();
    expect(names.every(name => name.length <= 120)).toBeTrue();
    expect(await service.duplicateMap('missing')).toBeFalse();
    const writes = electron.writeFileAtomic.calls.count();
    project$.next({ path: PROJECT, readOnly: true });
    expect(await service.duplicateMap('world')).toBeFalse();
    expect(electron.writeFileAtomic.calls.count()).toBe(writes);
  });

  it('rolls back failed duplication without changing the source map', async () => {
    await service.load();
    await service.apply(setPinPosition(service.snapshot!.map, 'a', 20, 30));
    const previous = service.snapshot!.map;
    electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Disk full' });
    expect(await service.duplicateMap('world')).toBeFalse();
    expect(service.snapshot!.maps!.length).toBe(1);
    expect(service.snapshot!.map).toEqual(previous);
  });

  it('imports, reloads and undoes a raster background without changing its bytes or existing pins', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 4;
    const url = canvas.toDataURL('image/png');
    await service.load();
    await service.apply(setPinPosition(service.snapshot!.map, 'a', 20, 30));
    expect(await service.importBackground(url, 'World.PNG')).toBeTrue();
    const background = service.snapshot!.map.background!;
    expect(background.file).toMatch(/^assets\/maps\/[^/]+\.png$/);
    expect(background.width / background.height).toBe(2);
    expect(electron.saveBase64Image).toHaveBeenCalledWith(url.split(',')[1], `${PROJECT}/${background.file}`);
    electron.getImageAsDataUrl.and.resolveTo(url);
    expect(await service.backgroundImage(background)).toBe(url);
    expect(electron.getImageAsDataUrl).toHaveBeenCalledWith(`${PROJECT}/${background.file}`);
    await service.load(true);
    expect(service.snapshot!.map.background).toEqual(background);
    expect(service.snapshot!.map.pins).toEqual([{ locationId: 'a', x: 20, y: 30 }]);
    await service.importBackground(svg, 'Replacement.svg');
    await service.undo();
    expect(service.snapshot!.map.background).toEqual(background);
  });

  it('keeps the existing map when a raster asset fails to save', async () => {
    await service.load();
    const original = service.snapshot!.map;
    const url = document.createElement('canvas').toDataURL('image/png');
    electron.saveBase64Image.and.resolveTo({ success: false, error: 'Disk full' });
    await expectAsync(service.importBackground(url, 'Map.png')).toBeRejectedWithError('Disk full');
    expect(service.snapshot!.map).toBe(original);
    expect(service.snapshot!.canUndo).toBeFalse();
  });

});
