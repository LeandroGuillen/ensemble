import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { WORLD_MAP_FILE } from '../constants/project.constants';
import { pathJoin } from '../utils/path.utils';
import { emptyWorldMap, parseWorldMap, serializeWorldMap, WorldMap } from '../utils/world-map.utils';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { ProjectService } from './project.service';

export interface WorldMapState {
  map: WorldMap;
  /** The project folder (or the map file) cannot be written: editing is disabled. */
  readOnly: boolean;
  /** The file exists but could not be parsed; editing is disabled so it is not overwritten. */
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

const UNDO_LIMIT = 100;

/**
 * Pins and roads of the project's world map (`world-map.md`). Every edit is
 * written straight away; edits made in this session can be undone.
 */
@Injectable({ providedIn: 'root' })
export class WorldMapService {
  private readonly stateSubject = new BehaviorSubject<WorldMapState | null>(null);
  readonly state$ = this.stateSubject.asObservable();

  private projectPath: string | null = null;
  private loadPromise: Promise<void> | null = null;
  private undoStack: WorldMap[] = [];
  private redoStack: WorldMap[] = [];
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

  /** Replaces the map with `next`, records undo, and writes the file. */
  async apply(next: WorldMap): Promise<boolean> {
    const state = this.stateSubject.value;
    if (!state || !this.isEditable(state)) return false;
    const savedRedo = this.redoStack;
    this.undoStack.push(state.map);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    if (!(await this.commit(next))) {
      this.undoStack.pop();
      this.redoStack = savedRedo;
      this.emitCurrent();
      return false;
    }
    return true;
  }

  async undo(): Promise<boolean> {
    const state = this.stateSubject.value;
    if (!state || !this.isEditable(state) || this.undoStack.length === 0) return false;
    const previous = this.undoStack.pop()!;
    this.redoStack.push(state.map);
    if (!(await this.commit(previous))) {
      this.redoStack.pop();
      this.undoStack.push(previous);
      this.emitCurrent();
      return false;
    }
    return true;
  }

  async redo(): Promise<boolean> {
    const state = this.stateSubject.value;
    if (!state || !this.isEditable(state) || this.redoStack.length === 0) return false;
    const next = this.redoStack.pop()!;
    this.undoStack.push(state.map);
    if (!(await this.commit(next))) {
      this.undoStack.pop();
      this.redoStack.push(next);
      this.emitCurrent();
      return false;
    }
    return true;
  }

  private isEditable(state: WorldMapState): boolean {
    return !state.readOnly && !state.error;
  }

  private reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastWritten = null;
    this.loadPromise = null;
    this.stateSubject.next(null);
  }

  private emit(map: WorldMap, readOnly: boolean, error: string | null): void {
    this.stateSubject.next({
      map,
      readOnly,
      error,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  private async readFromDisk(): Promise<void> {
    const filePath = this.filePath();
    if (!filePath) return;
    const projectPath = this.projectPath;
    let map = emptyWorldMap();
    let error: string | null = null;
    if (await this.electronService.fileExists(filePath)) {
      const result = await this.electronService.readFile(filePath);
      if (result.success) {
        const parsed = parseWorldMap(result.content ?? '');
        map = parsed.map;
        error = parsed.error ?? null;
        this.lastWritten = result.content ?? '';
      } else {
        error = result.error || 'Could not read the world map file';
      }
    }
    const writable = await this.electronService.isWritable(filePath);
    if (projectPath !== this.projectPath) return; // project switched meanwhile
    this.undoStack = [];
    this.redoStack = [];
    this.emit(map, !writable, error);
  }

  private emitCurrent(): void {
    const state = this.stateSubject.value;
    if (state) this.emit(state.map, state.readOnly, state.error);
  }

  /** Shows `next` and writes it. On failure, shows the previous map again and returns false. */
  private async commit(next: WorldMap): Promise<boolean> {
    const state = this.stateSubject.value;
    const filePath = this.filePath();
    if (!state || !filePath) return false;
    this.emit(next, state.readOnly, state.error);
    const names = new Map(this.locationService.getLocationsSnapshot().map((l) => [l.id, l.name]));
    const content = serializeWorldMap(next, names);
    const write = async () => {
      this.lastWritten = content;
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
      this.emit(state.map, state.readOnly || !writable, state.error);
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
