import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import {
  LOCATION_TYPES,
  Location,
  getLocationPlaceholderIcon,
  getLocationTypeLabel,
} from '../../core/interfaces/location.interface';
import { LocationService } from '../../core/services/location.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProjectService } from '../../core/services/project.service';
import { WorldMapService, WorldMapState } from '../../core/services/world-map.service';
import { isEditableKeyboardTarget } from '../../core/utils/list-keyboard.utils';
import {
  WorldMap,
  autoLayoutPins,
  removePin,
  roadKey,
  setPinPosition,
  setRoadLabel,
  toggleRoad,
} from '../../core/utils/world-map.utils';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

export interface PlacedPin {
  location: Location;
  x: number;
  y: number;
  icon: string;
  typeLabel: string;
}

export interface RoadView {
  key: string;
  from: PlacedPin;
  to: PlacedPin;
  label?: string;
}

type Drag =
  | { kind: 'pin'; id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean }
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; originTx: number; originTy: number; moved: boolean };

const DRAG_THRESHOLD = 4;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const KEY_STEP = 10;
const DROP_MIME = 'application/x-ensemble-location';
const TYPE_ORDER: readonly string[] = LOCATION_TYPES.map((t) => t.value);

@Component({
  selector: 'app-world-map',
  imports: [FormsModule, PageHeaderComponent],
  templateUrl: './world-map.component.html',
  styleUrls: ['./world-map.component.scss'],
})
export class WorldMapComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly worldMapService = inject(WorldMapService);
  private readonly locationService = inject(LocationService);
  private readonly projectService = inject(ProjectService);
  private readonly toasts = inject(NotificationService);
  private readonly logger = inject(LoggingService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('canvas') canvasRef?: ElementRef<SVGSVGElement>;

  isLoading = true;
  state: WorldMapState | null = null;
  locations: Location[] = [];
  placed: PlacedPin[] = [];
  roads: RoadView[] = [];
  unplaced: Location[] = [];
  unplacedFilter = '';

  /** Screen = world * k + (tx, ty). */
  view = { tx: 0, ty: 0, k: 1 };
  private viewInitialized = false;

  private drag: Drag | null = null;
  /** Live position of the pin being dragged (not saved until pointer up). */
  dragPosition: { id: string; x: number; y: number } | null = null;

  roadMode = false;
  roadFrom: string | null = null;
  selectedRoadKey: string | null = null;
  roadLabelDraft = '';
  dropActive = false;

  ngOnInit(): void {
    void this.loadAll();
    combineLatest([this.locationService.getLocations(), this.worldMapService.state$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([locations, state]) => {
        this.locations = locations;
        this.state = state;
        this.rebuild();
      });
  }

  get readOnly(): boolean {
    return !this.state || this.state.readOnly || !!this.state.error;
  }

  get hasLocations(): boolean {
    return this.locations.length > 0;
  }

  get filteredUnplaced(): Location[] {
    const q = this.unplacedFilter.trim().toLowerCase();
    return q ? this.unplaced.filter((l) => l.name.toLowerCase().includes(q)) : this.unplaced;
  }

  get selectedRoad(): RoadView | null {
    return this.roads.find((r) => r.key === this.selectedRoadKey) ?? null;
  }

  get transform(): string {
    return `translate(${this.view.tx} ${this.view.ty}) scale(${this.view.k})`;
  }

  readonly getIcon = (location: Location) => getLocationPlaceholderIcon(location.type);

  async loadAll(force = false): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) return;
    this.isLoading = true;
    try {
      if (force) {
        await Promise.all([this.locationService.forceReloadLocations(), this.worldMapService.load(true)]);
      } else {
        await Promise.all([this.locationService.loadLocations(project.path), this.worldMapService.load()]);
      }
    } catch (error) {
      this.logger.error('Failed to load the world map', error);
      this.toasts.showError(`Failed to load the world map: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.isLoading = false;
      this.rebuild();
    }
  }

  /** Recomputes the drawable pins/roads and the unplaced list. */
  rebuild(): void {
    const byId = new Map(this.locations.map((l) => [l.id, l]));
    const map = this.state?.map;
    const placed: PlacedPin[] = [];
    const placedIds = new Set<string>();
    for (const pin of map?.pins ?? []) {
      const location = byId.get(pin.locationId);
      if (!location) continue; // deleted location: keep in the file, do not draw
      const live = this.dragPosition?.id === pin.locationId ? this.dragPosition : pin;
      placed.push({
        location,
        x: live.x,
        y: live.y,
        icon: getLocationPlaceholderIcon(location.type),
        typeLabel: getLocationTypeLabel(location.type),
      });
      placedIds.add(pin.locationId);
    }
    const pinById = new Map(placed.map((p) => [p.location.id, p]));
    this.placed = placed;
    this.roads = (map?.roads ?? []).flatMap((road) => {
      const from = pinById.get(road.from);
      const to = pinById.get(road.to);
      return from && to ? [{ key: roadKey(road.from, road.to), from, to, label: road.label }] : [];
    });
    this.unplaced = this.locations
      .filter((l) => !placedIds.has(l.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (this.selectedRoadKey && !this.selectedRoad) this.selectedRoadKey = null;
    if (this.roadFrom && !pinById.has(this.roadFrom)) this.roadFrom = null;
    if (!this.viewInitialized && this.state && !this.isLoading) {
      this.viewInitialized = true;
      setTimeout(() => this.fitToView(), 0);
    }
    this.cdr.markForCheck();
  }

  // ---- Edits ---------------------------------------------------------------

  private async applyEdit(edit: (map: WorldMap) => WorldMap): Promise<void> {
    const state = this.worldMapService.snapshot;
    if (!state || this.readOnly) return;
    const ok = await this.worldMapService.apply(edit(state.map));
    if (!ok) this.reportSaveFailure();
  }

  private reportSaveFailure(): void {
    const reason = this.worldMapService.lastError;
    this.toasts.showError(
      this.worldMapService.snapshot?.readOnly
        ? 'The world map could not be saved: this project is read-only.'
        : `The world map could not be saved${reason ? `: ${reason}` : '.'}`
    );
  }

  async pinAllUnplaced(): Promise<void> {
    if (this.readOnly || this.unplaced.length === 0) return;
    const ids = [...this.unplaced]
      .sort((a, b) => {
        const ta = a.type ? TYPE_ORDER.indexOf(a.type) : TYPE_ORDER.length;
        const tb = b.type ? TYPE_ORDER.indexOf(b.type) : TYPE_ORDER.length;
        return ta - tb || a.name.localeCompare(b.name);
      })
      .map((l) => l.id);
    const existing = this.placed.map((p) => ({ locationId: p.location.id, x: p.x, y: p.y }));
    const added = autoLayoutPins(existing, ids);
    await this.applyEdit((map) => ({ ...map, pins: [...map.pins, ...added] }));
    setTimeout(() => this.fitToView(), 0);
  }

  async pinAtCenter(location: Location): Promise<void> {
    if (this.readOnly) return;
    const svg = this.canvasRef?.nativeElement;
    const rect = svg?.getBoundingClientRect();
    const center = rect
      ? this.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: 0, y: 0 };
    // Nudge so stacked pins stay clickable.
    let { x, y } = center;
    while (this.placed.some((p) => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30)) {
      x += 40;
      y += 40;
    }
    await this.applyEdit((map) => setPinPosition(map, location.id, x, y));
  }

  async unpin(locationId: string): Promise<void> {
    if (this.readOnly) return;
    if (this.roadFrom === locationId) this.roadFrom = null;
    await this.applyEdit((map) => removePin(map, locationId));
  }

  async undo(): Promise<void> {
    if (this.readOnly || !this.state?.canUndo) return;
    if (!(await this.worldMapService.undo())) this.reportSaveFailure();
  }

  async redo(): Promise<void> {
    if (this.readOnly || !this.state?.canRedo) return;
    if (!(await this.worldMapService.redo())) this.reportSaveFailure();
  }

  toggleRoadMode(): void {
    if (this.readOnly) return;
    this.roadMode = !this.roadMode;
    this.roadFrom = null;
  }

  selectRoad(road: RoadView, event?: Event): void {
    event?.stopPropagation();
    void this.saveRoadLabel();
    this.selectedRoadKey = road.key;
    this.roadLabelDraft = road.label ?? '';
  }

  async saveRoadLabel(): Promise<void> {
    const road = this.selectedRoad;
    if (!road || this.readOnly || (road.label ?? '') === this.roadLabelDraft.trim()) return;
    await this.applyEdit((map) => setRoadLabel(map, road.from.location.id, road.to.location.id, this.roadLabelDraft));
  }

  /** Escape saves the draft before dismissing the panel, even from its input. */
  dismissRoadPanel(): void {
    void this.saveRoadLabel();
    this.roadMode = false;
    this.roadFrom = null;
    this.selectedRoadKey = null;
  }

  async deleteSelectedRoad(): Promise<void> {
    const road = this.selectedRoad;
    if (!road || this.readOnly) return;
    await this.saveRoadLabel();
    this.selectedRoadKey = null;
    await this.applyEdit((map) => toggleRoad(map, road.from.location.id, road.to.location.id));
  }

  /** Click (or Enter) on a pin: connect in road mode, otherwise open the location. */
  async activatePin(pin: PlacedPin): Promise<void> {
    if (this.roadMode && !this.readOnly) {
      const id = pin.location.id;
      if (!this.roadFrom) {
        this.roadFrom = id;
      } else if (this.roadFrom === id) {
        this.roadFrom = null;
      } else {
        const from = this.roadFrom;
        this.roadFrom = id; // chain: the next click continues the road from here
        await this.applyEdit((map) => toggleRoad(map, from, id));
      }
      return;
    }
    void this.router.navigate(['/location', pin.location.id]);
  }

  openLocation(location: Location): void {
    void this.router.navigate(['/location', location.id]);
  }

  createLocation(): void {
    void this.router.navigate(['/location']);
  }

  /** Keyboard on a focused pin: arrows move it, Delete unpins it, Enter activates. */
  async onPinKeydown(pin: PlacedPin, event: KeyboardEvent): Promise<void> {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      await this.activatePin(pin);
      return;
    }
    if (this.readOnly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation(); // The document shortcut must not also delete a selected road.
      await this.unpin(pin.location.id);
      return;
    }
    const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    await this.applyEdit((map) => setPinPosition(map, pin.location.id, pin.x + move[0], pin.y + move[1]));
  }

  // ---- Pointer: drag pins, pan the canvas ----------------------------------

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (clientX - left - this.view.tx) / this.view.k,
      y: (clientY - top - this.view.ty) / this.view.k,
    };
  }

  onPinPointerDown(pin: PlacedPin, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.canvasRef?.nativeElement.setPointerCapture?.(event.pointerId);
    this.drag = {
      kind: 'pin',
      id: pin.location.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pin.x,
      originY: pin.y,
      moved: false,
    };
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    // Pointerdown precedes input blur; save while the edited road is still selected.
    void this.saveRoadLabel();
    this.selectedRoadKey = null;
    this.canvasRef?.nativeElement.setPointerCapture?.(event.pointerId);
    this.drag = {
      kind: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originTx: this.view.tx,
      originTy: this.view.ty,
      moved: false,
    };
  }

  onCanvasPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    if (drag.kind === 'pan') {
      this.view = { ...this.view, tx: drag.originTx + dx, ty: drag.originTy + dy };
      return;
    }
    if (this.readOnly) return;
    this.dragPosition = {
      id: drag.id,
      x: drag.originX + dx / this.view.k,
      y: drag.originY + dy / this.view.k,
    };
    this.rebuild();
  }

  async onCanvasPointerUp(event: PointerEvent): Promise<void> {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.canvasRef?.nativeElement.releasePointerCapture?.(event.pointerId);
    if (drag.kind === 'pan') {
      if (!drag.moved && this.roadMode) this.roadFrom = null;
      return;
    }
    const pin = this.placed.find((p) => p.location.id === drag.id);
    if (!drag.moved) {
      if (pin) await this.activatePin(pin);
      return;
    }
    const position = this.dragPosition;
    if (!position || this.readOnly) {
      this.dragPosition = null;
      this.rebuild();
      return;
    }
    try {
      await this.applyEdit((map) => setPinPosition(map, position.id, position.x, position.y));
    } finally {
      this.dragPosition = null;
      this.rebuild();
    }
  }

  onCanvasPointerCancel(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = null;
    this.dragPosition = null;
    this.rebuild();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
    this.zoomAt(event.clientX, event.clientY, factor);
  }

  zoomBy(factor: number): void {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.k * factor));
    const ratio = k / this.view.k;
    this.view = { k, tx: sx - (sx - this.view.tx) * ratio, ty: sy - (sy - this.view.ty) * ratio };
  }

  fitToView(): void {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    if (this.placed.length === 0) {
      this.view = { k: 1, tx: rect.width / 2, ty: rect.height / 2 };
      this.cdr.markForCheck();
      return;
    }
    const xs = this.placed.map((p) => p.x);
    const ys = this.placed.map((p) => p.y);
    const minX = Math.min(...xs) - 80;
    const maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 80;
    const k = Math.min(1.5, Math.max(MIN_ZOOM, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
    this.view = {
      k,
      tx: rect.width / 2 - ((minX + maxX) / 2) * k,
      ty: rect.height / 2 - ((minY + maxY) / 2) * k,
    };
    this.cdr.markForCheck();
  }

  // ---- Drag from the "Not on the map" list ---------------------------------

  onListDragStart(location: Location, event: DragEvent): void {
    if (this.readOnly || !event.dataTransfer) return;
    event.dataTransfer.setData(DROP_MIME, location.id);
    event.dataTransfer.setData('text/plain', location.name);
    event.dataTransfer.effectAllowed = 'copy';
  }

  onCanvasDragOver(event: DragEvent): void {
    if (this.readOnly || !event.dataTransfer?.types.includes(DROP_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dropActive = true;
  }

  onCanvasDragLeave(): void {
    this.dropActive = false;
  }

  async onCanvasDrop(event: DragEvent): Promise<void> {
    this.dropActive = false;
    const id = event.dataTransfer?.getData(DROP_MIME);
    if (!id || this.readOnly) return;
    event.preventDefault();
    if (!this.locations.some((l) => l.id === id)) return;
    const { x, y } = this.toWorld(event.clientX, event.clientY);
    await this.applyEdit((map) => setPinPosition(map, id, x, y));
  }

  // ---- Keyboard ------------------------------------------------------------

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (isEditableKeyboardTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void this.undo();
    } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      void this.redo();
    } else if (event.key === 'Escape' && (this.roadMode || this.selectedRoadKey)) {
      event.preventDefault();
      this.dismissRoadPanel();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedRoadKey && !mod) {
      event.preventDefault();
      void this.deleteSelectedRoad();
    }
  }

  trackPin = (_: number, pin: PlacedPin) => pin.location.id;
}
