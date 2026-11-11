import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { WORLD_MAP_FILE } from '../constants/project.constants';
import { pathJoin } from '../utils/path.utils';
import { emptyWorldMap, emptyWorldMaps, parseWorldMaps, serializeWorldMaps, parseMapBackground, NamedWorldMap, WorldMapCollection, WorldMapBackground, WorldMap, MapMembership } from '../utils/world-map.utils';
import { inspectMapSvg, mapSvgUrl, mapImageExtension, inspectRasterMapImage } from '../utils/map-background.utils';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { ProjectService } from './project.service';

export interface WorldMapState {
  map: WorldMap;
  maps?: NamedWorldMap[];
  activeMapId?: string;
  /** The project folder (or the map file) cannot be written: editing is disabled. */
  readOnly: boolean;
  /** The file exists but could not be parsed; editing is disabled so it is not overwritten. */
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

const UNDO_LIMIT = 100;
interface MapHistory { collection: WorldMapCollection; activeMapId: string; }

/**
 * Pins and roads of the project's world map (`world-map.md`). Every edit is
 * written straight away; edits made in this session can be undone.
 */
@Injectable({ providedIn: 'root' })
export class WorldMapService {
  private readonly stateSubject = new BehaviorSubject<WorldMapState | null>(null);
  readonly state$ = this.stateSubject.asObservable();

  private projectPath: string | null = null;
  private projectReadOnly = false;
  private projectGeneration = 0;
  private loadPromise: Promise<void> | null = null;
  private collection = emptyWorldMaps();
  private activeMapId = 'world';
  private undoStack: MapHistory[] = [];
  private redoStack: MapHistory[] = [];
  /** Last content written by us, to ignore our own watcher echo. */
  private lastWritten: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private locationService: LocationService,
    private fileWatcherService: FileWatcherService,
    private logger: LoggingService
  ) {
    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      const path = project?.path ?? null;
      this.projectReadOnly = !!project?.readOnly;
      if (path !== this.projectPath) {
        this.projectPath = path;
        this.reset();
      }
    });
    this.fileWatcherService.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => {
      void this.handleFileChange(event);
    });
  }

  get snapshot(): WorldMapState | null {
    return this.stateSubject.value;
  }

  filePath(): string | null {
    return this.projectPath ? pathJoin(this.projectPath, WORLD_MAP_FILE) : null;
  }

  /** Loads once per project; `force` re-reads the file. */
  load(force = false): Promise<void> {
    if (!force && this.stateSubject.value) return Promise.resolve();
    if (!force && this.loadPromise) return this.loadPromise;
    const promise = this.readFromDisk().finally(() => {
      if (this.loadPromise === promise) this.loadPromise = null;
    });
    this.loadPromise = promise;
    return promise;
  }

  /** Import first, then reference the asset. Never overwrite an asset used by history. */
  async importBackground(source: string, name: string): Promise<boolean> {
    const state = this.snapshot;
    const project = this.projectPath;
    const generation = this.projectGeneration;
    const mapId = this.activeMapId;
    if (!state || !project || !this.isEditable(state)) return false;
    const extension = mapImageExtension(name);
    const raster = extension === 'svg' ? null : await inspectRasterMapImage(source, name);
    const image = raster || inspectMapSvg(source);
    const { width, height } = image;
    const current = () => generation === this.projectGeneration && !!this.snapshot && this.isEditable(this.snapshot) && this.collection.maps.some(entry => entry.id === mapId);
    if (!current()) return false;
    const file = `assets/maps/${crypto.randomUUID()}.${extension}`;
    const directory = await this.electronService.createDirectory(pathJoin(project, 'assets/maps'));
    if (!directory.success) throw new Error(directory.error || 'Could not create the map asset folder.');
    if (!current()) return false;
    const written = raster
      ? await this.electronService.saveBase64Image(raster.base64, pathJoin(project, file))
      : await this.electronService.writeFileAtomic(pathJoin(project, file), source);
    if (!written.success) throw new Error(written.error || 'Could not save the background image.');
    if (!current()) return false;
    const map = this.collection.maps.find(entry => entry.id === mapId)!.map;
    const previous = map.background;
    // Replacement preserves the existing frame. A new map is centred on world origin.
    const initialScale = Math.max(1, 1000 / Math.max(width, height));
    const frameWidth = previous?.width ?? width * initialScale;
    const frameHeight = frameWidth * height / width;
    const background: WorldMapBackground = {
      file, name: name.slice(0, 255), width: frameWidth, height: frameHeight,
      x: previous?.x ?? -frameWidth / 2, y: previous?.y ?? -frameHeight / 2,
      opacity: previous?.opacity ?? 1, visible: true,
    };
    if (!parseMapBackground(background)) throw new Error('The replacement map dimensions exceed the supported range.');
    return this.applyToMap(mapId, { ...map, background });
  }

  async backgroundImage(background: WorldMapBackground): Promise<string> {
    const project = this.projectPath;
    if (!project || !parseMapBackground(background)) throw new Error('Invalid map background path.');
    if (mapImageExtension(background.file) !== 'svg') {
      const url = await this.electronService.getImageAsDataUrl(pathJoin(project, background.file));
      if (!url) throw new Error('Could not read the background image.');
      return (await inspectRasterMapImage(url, background.file)).url;
    }
    const result = await this.electronService.readFile(pathJoin(project, background.file));
    if (!result.success || !result.content) throw new Error(result.error || 'Could not read the SVG background.');
    inspectMapSvg(result.content);
    return mapSvgUrl(result.content);
  }

  /** Selection is a local preference: browsing never writes project files or records undo. */
  selectMap(id: string): boolean {
    const state = this.snapshot;
    if (!state || !this.collection.maps.some(entry => entry.id === id)) return false;
    this.emit(this.collection, id, state.readOnly, state.error);
    return true;
  }

  async createMap(name: string, membership?: MapMembership): Promise<boolean> {
    const clean = this.validateName(name);
    if (!clean) return false;
    const id = crypto.randomUUID();
    return this.applyCollection({ maps: [...this.collection.maps, { id, name: clean, map: { ...emptyWorldMap(), ...(membership ? { membership } : {}) } }] }, id);
  }

  /** Independent map data; immutable background assets can safely be referenced by both maps. */
  async duplicateMap(id: string): Promise<boolean> {
    const state = this.snapshot;
    if (!state || !this.isEditable(state)) return false;
    const source = this.collection.maps.find(entry => entry.id === id);
    if (!source) return false;
    const names = new Set(this.collection.maps.map(entry => entry.name.toLowerCase()));
    let number = 1;
    let name: string;
    do {
      const suffix = number === 1 ? ' copy' : ` copy ${number}`;
      name = source.name.slice(0, 120 - suffix.length).trimEnd() + suffix;
      number++;
    } while (names.has(name.toLowerCase()));
    const copy: NamedWorldMap = { id: crypto.randomUUID(), name, map: structuredClone(source.map) };
    return this.applyCollection({ maps: [...this.collection.maps, copy] }, copy.id);
  }

  /** Maps share one file; retain their data in session history and keep imported artwork for undo. */
  async deleteMap(id: string): Promise<boolean> {
    const index = this.collection.maps.findIndex(map => map.id === id);
    if (index < 0) return false;
    if (this.collection.maps.length <= 1) {
      this.lastError = 'Keep at least one map. Create another map before deleting this one.';
      return false;
    }
    const maps = this.collection.maps.filter(map => map.id !== id);
    const activeId = id === this.activeMapId ? maps[Math.max(0, index - 1)].id : this.activeMapId;
    return this.applyCollection({ maps }, activeId);
  }

  async renameMap(id: string, name: string): Promise<boolean> {
    if (!this.collection.maps.some(entry => entry.id === id)) return false;
    const clean = this.validateName(name, id);
    if (!clean) return false;
    if (this.collection.maps.find(entry => entry.id === id)!.name === clean) return true;
    return this.applyCollection({ maps: this.collection.maps.map(entry => entry.id === id ? { ...entry, name: clean } : entry) });
  }

  private validateName(name: string, exceptId?: string): string | null {
    const clean = name.trim();
    if (!clean || clean.length > 120) { this.lastError = 'Enter a map name between 1 and 120 characters.'; return null; }
    if (this.collection.maps.some(entry => entry.id !== exceptId && entry.name.toLowerCase() === clean.toLowerCase())) {
      this.lastError = 'A map with that name already exists.';
      return null;
    }
    return clean;
  }

  /** Replaces only this map; shared Locations and other maps are untouched. */
  apply(next: WorldMap): Promise<boolean> { return this.applyToMap(this.activeMapId, next); }

  private applyToMap(id: string, next: WorldMap): Promise<boolean> {
    if (!this.collection.maps.some(entry => entry.id === id)) return Promise.resolve(false);
    return this.applyCollection({ maps: this.collection.maps.map(entry => entry.id === id ? { ...entry, map: next } : entry) });
  }

  private history(): MapHistory { return { collection: this.collection, activeMapId: this.activeMapId }; }

  private async applyCollection(next: WorldMapCollection, activeMapId = this.activeMapId): Promise<boolean> {
    const state = this.snapshot;
    if (!state || !this.isEditable(state)) return false;
    const generation = this.projectGeneration;
    const savedRedo = this.redoStack;
    this.undoStack.push(this.history());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    if (!(await this.commit(next, activeMapId))) {
      if (generation !== this.projectGeneration) return false;
      this.undoStack.pop();
      this.redoStack = savedRedo;
      this.emitCurrent();
      return false;
    }
    return true;
  }

  async undo(): Promise<boolean> {
    const state = this.snapshot;
    if (!state || !this.isEditable(state) || !this.undoStack.length) return false;
    const generation = this.projectGeneration;
    const previous = this.undoStack.pop()!;
    this.redoStack.push(this.history());
    if (!(await this.commit(previous.collection, previous.activeMapId))) {
      if (generation !== this.projectGeneration) return false;
      this.redoStack.pop();
      this.undoStack.push(previous);
      this.emitCurrent();
      return false;
    }
    return true;
  }

  async redo(): Promise<boolean> {
    const state = this.snapshot;
    if (!state || !this.isEditable(state) || !this.redoStack.length) return false;
    const generation = this.projectGeneration;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.history());
    if (!(await this.commit(next.collection, next.activeMapId))) {
      if (generation !== this.projectGeneration) return false;
      this.redoStack.push(next);
      this.undoStack.pop();
      this.emitCurrent();
      return false;
    }
    return true;
  }

  private isEditable(state: WorldMapState): boolean {
    return !this.projectReadOnly && !state.readOnly && !state.error;
  }

  private reset(): void {
    this.projectGeneration++;
    this.collection = emptyWorldMaps();
    this.activeMapId = 'world';
    this.undoStack = [];
    this.redoStack = [];
    this.lastWritten = null;
    this.loadPromise = null;
    this.stateSubject.next(null);
  }

  private selectionKey(): string { return `ensemble:active-map:${this.projectPath}`; }

  private emit(collection: WorldMapCollection, activeMapId: string, readOnly: boolean, error: string | null): void {
    this.collection = collection;
    this.activeMapId = collection.maps.some(entry => entry.id === activeMapId) ? activeMapId : collection.maps[0].id;
    try { localStorage.setItem(this.selectionKey(), this.activeMapId); } catch { /* Storage can be unavailable. */ }
    this.stateSubject.next({
      map: collection.maps.find(entry => entry.id === this.activeMapId)!.map,
      maps: collection.maps,
      activeMapId: this.activeMapId,
      readOnly, error,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  private async readFromDisk(): Promise<void> {
    const filePath = this.filePath();
    if (!filePath) return;
    const generation = this.projectGeneration;
    let collection = emptyWorldMaps();
    let error: string | null = null;
    if (await this.electronService.fileExists(filePath)) {
      const result = await this.electronService.readFile(filePath);
      if (result.success) {
        const parsed = parseWorldMaps(result.content ?? '');
        collection = parsed.collection;
        error = parsed.error ?? null;
        this.lastWritten = result.content ?? '';
      } else {
        error = result.error || 'Could not read the world map file';
      }
    }
    const writable = await this.electronService.isWritable(filePath);
    if (generation !== this.projectGeneration) return; // project switched meanwhile
    this.undoStack = [];
    this.redoStack = [];
    let selection = this.activeMapId;
    try { selection = localStorage.getItem(this.selectionKey()) || selection; } catch { /* Use first map. */ }
    this.emit(collection, selection, this.projectReadOnly || !writable, error);
  }

  private emitCurrent(): void {
    const state = this.stateSubject.value;
    if (state) this.emit(this.collection, this.activeMapId, state.readOnly, state.error);
  }

  /** Shows `next` and writes it. On failure, shows the previous map again and returns false. */
  private async commit(next: WorldMapCollection, activeMapId: string): Promise<boolean> {
    const state = this.stateSubject.value;
    const filePath = this.filePath();
    if (!state || !filePath) return false;
    const previous = this.collection;
    const previousActiveMapId = this.activeMapId;
    const generation = this.projectGeneration;
    this.emit(next, activeMapId, state.readOnly, state.error);
    const names = new Map(this.locationService.getLocationsSnapshot().map((l) => [l.id, l.name]));
    const content = serializeWorldMaps(next, names);
    const write = async () => {
      if (generation === this.projectGeneration) this.lastWritten = content;
      const result = await this.electronService.writeFileAtomic(filePath, content);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save the world map');
      }
    };
    const run = this.writeChain.then(write);
    this.writeChain = run.catch(() => undefined);
    try {
      await run;
      return true;
    } catch (error) {
      this.logger.error('Failed to save world map', error);
      this.lastError = error instanceof Error ? error.message : String(error);
      // Stop editing when the project turned out not to be writable.
      const writable = await this.electronService.isWritable(filePath);
      if (generation === this.projectGeneration) this.emit(previous, previousActiveMapId, state.readOnly || !writable, state.error);
      return false;
    }
  }

  /** Message of the last failed save (for a toast). */
  lastError: string | null = null;

  private async handleFileChange(event: FileChangeEvent): Promise<void> {
    const filePath = this.filePath();
    if (!filePath || !this.stateSubject.value || event.path !== filePath) return;
    if (event.type === 'unlink') {
      this.lastWritten = null;
      await this.load(true);
      return;
    }
    const result = await this.electronService.readFile(filePath);
    if (!result.success || result.content === this.lastWritten) return;
    await this.load(true);
  }
}
