import { LocationDetailComponent } from '../location-detail/location-detail.component';
import { PreferencesService } from '../../core/services/preferences.service';
import { getBookDisplayName } from '../../core/utils/book-display.utils';
import { ProjectReadOnlyDirective } from '../../shared/project-read-only.directive';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { CdkContextMenuTrigger, CdkMenuModule } from '@angular/cdk/menu';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { combineLatest } from 'rxjs';
import {
  LOCATION_TYPES,
  Location,
  getLocationMapIcon,
  getLocationPlaceholderIcon,
  getLocationTypeLabel,
} from '../../core/interfaces/location.interface';
import { LocationService } from '../../core/services/location.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProjectService } from '../../core/services/project.service';
import { WorldMapService, WorldMapState } from '../../core/services/world-map.service';
import { isEditableKeyboardTarget, isInteractiveKeyboardTarget } from '../../core/utils/list-keyboard.utils';
import {
  WorldMap,
  MapPoint, WorldMapArea, DEFAULT_AREA_COLOR, normalizeAreaPoints, setLocationArea, removeLocationArea,
  MapMembership,
  mapMembership,
  isMapMember,
  setMapRules,
  mapRulesRemovals,
  includeMapLocation,
  removePin, removeAreaPin,
  roadKey,
  setPinPosition,
  setRoadLabel,
  toggleRoad,
} from '../../core/utils/world-map.utils';
import { MAP_IMAGE_ACCEPT, readMapImageFile } from '../../core/utils/map-background.utils';
import { ModalFrameComponent } from '../../shared/modal-frame/modal-frame.component';

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
const MIN_EMPTY_ZOOM = 0.15;
const MAX_EMPTY_ZOOM = 8;
const MIN_MAP_OVERVIEW = 0.8;
const MAX_MAP_DETAIL = 64;
const KEY_STEP = 10;
const DROP_MIME = 'application/x-ensemble-location';

@Component({
  selector: 'app-world-map',
  imports: [LocationDetailComponent, ProjectReadOnlyDirective, FormsModule, ModalFrameComponent, CdkMenuModule, OverlayModule],
  templateUrl: './world-map.component.html',
  styleUrls: ['./world-map.component.scss'],
})
export class WorldMapComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly preferences = inject(PreferencesService);
  private readonly route = inject(ActivatedRoute);
  @ViewChild(LocationDetailComponent) details?: LocationDetailComponent;
  private static readonly views = new Map<string, { tx: number; ty: number; k: number }>();
  private currentViewKey: string | null = null;
  private readonly mapFilters = new Map<string, { search: string; book: string; type: string; picture: string }>();
  drawerOpen = false;
  markerMode = this.preferences.getMapMarkerMode();
  setMarkerMode(mode: 'image' | 'icon'): void {
    this.markerMode = mode;
    this.preferences.setMapMarkerMode(mode);
  }
  async changePlacement(place: boolean): Promise<void> {
    const location = this.details?.location || this.selectedLocation;
    if (!location) return;
    if (this.readOnly) return;
    this.cancelArea();
    if (place) {
      const map = this.state?.map;
      if (!map) return;
      if (!isMapMember(map, location) && !(await this.applyEdit(map => includeMapLocation(map, location.id)))) return;
      this.placementLocation = location;
      this.roadMode = false;
      this.roadFrom = null;
    } else await this.unpin(location.id);
  }
  searchTerm = localStorage.getItem('locationSearchTerm') || '';
  selectedBook = localStorage.getItem('locationSelectedBook') || '';
  selectedType = localStorage.getItem('locationSelectedType') || '';
  selectedPictureFilter = localStorage.getItem('locationSelectedPicture') || '';
  readonly locationTypes = LOCATION_TYPES;
  readonly mapImageAccept = MAP_IMAGE_ACCEPT;
  readonly bookLabel = getBookDisplayName;
  thumbnailUrls = new Map<string, string>();
  private thumbnailGeneration = 0;
  get detailsSide(): 'left' | 'right' { return this.preferences.getLocationDetailsSide(); }
  get books() { return this.projectService.getCurrentProject()?.metadata?.books || []; }
  get selectedLocation(): Location | undefined { return this.locations.find(location => location.id === this.selectedLocationId); }
  get selectedPin() { return this.state?.map.pins.find(pin => pin.locationId === this.selectedLocationId && this.mapLocations.some(location => location.id === pin.locationId)); }
  get selectedLocationId(): string | null { return this.route.snapshot.paramMap.get('id') || this.details?.locationId || null; }
  get filteredLocations(): Location[] {
    const q = this.searchTerm.trim().toLowerCase();
    return this.locations.filter(location => {
      if (this.selectedType === 'unspecified' ? !!location.type : this.selectedType && location.type !== this.selectedType) return false;
      if (this.selectedBook && !location.books.includes(this.selectedBook)) return false;
      if (this.selectedPictureFilter === 'with' && !location.thumbnail) return false;
      if (this.selectedPictureFilter === 'without' && location.thumbnail) return false;
      const books = this.books.filter(book => location.books.includes(book.id)).map(getBookDisplayName).join(' ');
      return !q || [location.name, ...(location.aliases || []), location.content, getLocationTypeLabel(location.type), books]
        .some(value => value.toLowerCase().includes(q));
    });
  }
  filtersChanged(): void {
    if (this.currentViewKey) this.mapFilters.set(this.currentViewKey, {
      search: this.searchTerm, book: this.selectedBook, type: this.selectedType, picture: this.selectedPictureFilter,
    });
    this.rebuild();
  }
  clearFilters(): void {
    this.searchTerm = this.selectedBook = this.selectedType = this.selectedPictureFilter = '';
    this.filtersChanged();
  }
  canLeave(discardAndClose = false): boolean | Promise<boolean> { return this.details?.canLeave(discardAndClose) ?? true; }
  private resizeObserver?: ResizeObserver;
  private mapRouteInitialized = false;
  private locationClickTimer?: ReturnType<typeof setTimeout>;
  private pinMenuTrigger: CdkContextMenuTrigger | null = null;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyRef.destroyed) return;
      if (this.viewInitialized) this.constrainView();
      this.cdr.markForCheck();
    });
    this.resizeObserver.observe(canvas);
  }

  ngOnDestroy(): void {
    this.cancelLocationClick();
    this.resizeObserver?.disconnect();
    this.closePinMenu();
    if (this.currentViewKey) WorldMapComponent.views.set(this.currentViewKey, { ...this.view });
    this.thumbnailGeneration++;
    this.backgroundGeneration++;
  }
  private async loadMarkerImages(locations: Location[]): Promise<void> {
    const generation = ++this.thumbnailGeneration;
    const pairs = await Promise.all(locations.filter(location => location.thumbnail)
      .map(async location => {
        try { return [location.id, await this.locationService.loadThumbnailForLocation(location)] as const; }
        catch { return [location.id, null] as const; }
      }));
    if (generation !== this.thumbnailGeneration || this.destroyRef.destroyed) return;
    this.thumbnailUrls = new Map(pairs.filter((pair): pair is readonly [string, string] => !!pair[1]));
    this.cdr.markForCheck();
  }
  private readonly destroyRef = inject(DestroyRef);
  private readonly worldMapService = inject(WorldMapService);
  private readonly locationService = inject(LocationService);
  private readonly projectService = inject(ProjectService);
  private readonly toasts = inject(NotificationService);
  private readonly logger = inject(LoggingService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('canvas') canvasRef?: ElementRef<SVGSVGElement>;
  @ViewChild('filterButton') filterButtonRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('options') optionsRef?: ElementRef<HTMLDetailsElement>;

  isLoading = true;
  state: WorldMapState | null = null;
  locations: Location[] = [];
  placed: PlacedPin[] = [];
  roads: RoadView[] = [];
  unplaced: Location[] = [];

  /** Screen = world * k + (tx, ty). */
  view = { tx: 0, ty: 0, k: 1 };
  private viewInitialized = false;

  private drag: Drag | null = null;
  private placementPointer: { x: number; y: number; id: number } | null = null;
  /** Live position of the pin being dragged (not saved until pointer up). */
  dragPosition: { id: string; x: number; y: number } | null = null;

  areaLocation: Location | null = null;
  areaPoints: MapPoint[] = [];
  areaColor = DEFAULT_AREA_COLOR;
  areaSaving = false;
  areaEditing = false;
  selectedAreaPoint: number | null = null;
  private areaPointDrag: { pointerId: number; index: number; start: MapPoint; clientX: number; clientY: number } | null = null;
  private areaBase: WorldMap | null = null;
  areaError = '';
  get areas(): (WorldMapArea & { location: Location; shape: string; x: number; y: number })[] {
    const locations = new Map(this.filteredLocations.filter(l => this.state && isMapMember(this.state.map, l)).map(l => [l.id, l]));
    return (this.state?.map.areas || []).flatMap(area => {
      const location = locations.get(area.locationId);
      if (!location) return [];
      return [{ ...area, location, shape: this.areaShape(area.points),
        x: area.points.reduce((sum, p) => sum + p.x, 0) / area.points.length,
        y: area.points.reduce((sum, p) => sum + p.y, 0) / area.points.length }];
    });
  }
  areaShape(points: MapPoint[]): string { return points.map(p => `${p.x},${p.y}`).join(' '); }
  hasArea(id: string): boolean { return !!this.state?.map.areas?.some(area => area.locationId === id); }
  async beginArea(location: Location, edit = this.hasArea(location.id)): Promise<void> {
    if (this.readOnly || this.mapBusy || this.areaSaving) return;
    if (this.membershipOpen && this.membershipChanged) {
      this.membershipError = 'Apply your location changes before drawing areas.';
      return;
    }
    await this.saveRoadLabel();
    this.closePinMenu();
    this.membershipOpen = false;
    this.placementLocation = null;
    this.roadMode = false;
    this.roadFrom = this.selectedRoadKey = null;
    this.areaLocation = location;
    const existing = this.state?.map.areas?.find(area => area.locationId === location.id);
    this.areaEditing = edit && !!existing;
    this.areaPoints = this.areaEditing ? existing!.points.map(point => ({ ...point })) : [];
    this.selectedAreaPoint = null;
    this.areaColor = this.state?.map.areas?.find(area => area.locationId === location.id)?.color || DEFAULT_AREA_COLOR;
    this.areaBase = this.state?.map || null;
    this.areaError = '';
  }
  cancelArea(): void {
    if (this.areaSaving) return;
    if (this.areaPointDrag) this.canvasRef?.nativeElement.releasePointerCapture?.(this.areaPointDrag.pointerId);
    this.areaPointDrag = null;
    this.areaEditing = false;
    this.selectedAreaPoint = null;
    this.areaLocation = null;
    this.areaPoints = [];
    this.areaBase = null;
    this.areaError = '';
  }
  insertAreaPoint(after: number): number | null {
    if (!this.areaEditing || this.readOnly || this.areaSaving || !this.areaPoints[after]) return null;
    if (this.areaPoints.length >= 2000) { this.areaError = 'An area supports up to 2,000 points.'; return null; }
    const a = this.areaPoints[after], b = this.areaPoints[(after + 1) % this.areaPoints.length];
    const point = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
    this.areaPoints = [...this.areaPoints.slice(0, after + 1), point, ...this.areaPoints.slice(after + 1)];
    this.selectedAreaPoint = after + 1;
    this.areaError = '';
    return after + 1;
  }
  deleteAreaPoint(): void {
    if (!this.areaEditing || this.readOnly || this.areaSaving || this.selectedAreaPoint === null || this.areaPoints.length <= 3) return;
    this.areaPoints = this.areaPoints.filter((_, index) => index !== this.selectedAreaPoint);
    this.selectedAreaPoint = null;
    this.areaError = '';
  }
  onAreaPointDown(index: number, event: PointerEvent): void {
    if (event.button !== 0 || !this.areaEditing || this.readOnly || this.areaSaving) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedAreaPoint = index;
    (event.currentTarget as SVGElement | null)?.focus();
    this.areaPointDrag = { pointerId: event.pointerId, index, start: { ...this.areaPoints[index] }, clientX: event.clientX, clientY: event.clientY };
    this.canvasRef?.nativeElement.setPointerCapture?.(event.pointerId);
  }
  onAreaEdgeDown(index: number, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    const added = this.insertAreaPoint(index);
    if (added !== null) this.onAreaPointDown(added, event);
  }
  onAreaPointKeydown(index: number, event: KeyboardEvent): void {
    if (!this.areaEditing || this.readOnly || this.areaSaving) return;
    this.selectedAreaPoint = index;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); this.deleteAreaPoint(); return;
    }
    const step = (event.shiftKey ? 10 : 1) / this.view.k;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault(); event.stopPropagation();
    this.areaPoints = this.areaPoints.map((point, i) => i === index ? { x: point.x + move[0], y: point.y + move[1] } : point);
    this.areaError = '';
  }
  async finishArea(): Promise<void> {
    const location = this.areaLocation;
    if (!location || this.readOnly || this.areaSaving || this.areaPointDrag) return;
    if (this.state?.map !== this.areaBase) {
      this.areaError = 'The map changed while editing. Cancel and reopen the area to use the latest map.';
      return;
    }
    if (!normalizeAreaPoints(this.areaPoints)) {
      this.areaError = 'Choose at least three distinct points enclosing an area.';
      return;
    }
    this.areaSaving = true;
    try {
      const saved = await this.applyEdit(map => setLocationArea(map, location.id, this.areaPoints, this.areaColor));
      this.areaSaving = false;
      if (saved) this.cancelArea();
    } finally {
      this.areaSaving = false;
      this.cdr.markForCheck();
    }
  }
  hasPin(id: string): boolean { return !!this.state?.map.pins.some(pin => pin.locationId === id); }
  async removePinKeepArea(id: string): Promise<void> {
    if (this.readOnly || this.areaSaving || !this.hasArea(id) || !this.hasPin(id)) return;
    this.closePinMenu();
    await this.saveRoadLabel();
    if (this.roadFrom === id) this.roadFrom = null;
    await this.applyEdit(map => removeAreaPin(map, id));
  }
  async removeArea(id: string): Promise<void> {
    await this.applyEdit(map => removeLocationArea(map, id));
  }

  roadMode = false;
  roadFrom: string | null = null;
  selectedRoadKey: string | null = null;
  roadLabelDraft = '';
  dropActive = false;

  ngOnInit(): void {
    const updateDrawer = () => {
      this.drawerOpen = this.route.snapshot.routeConfig?.path === 'location' || this.route.snapshot.routeConfig?.path === 'location/:id';
      this.cdr.markForCheck();
    };
    updateDrawer();
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(event => {
      if (event instanceof NavigationEnd) {
        updateDrawer();
        this.syncMapFromRoute();
      }
    });
    void this.loadAll();
    this.locationService.getLocations().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(locations => { void this.loadMarkerImages(locations); });
    combineLatest([this.locationService.getLocations(), this.worldMapService.state$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([locations, state]) => {
        this.locations = locations;
        const key = state ? `${this.projectService.getCurrentProject()?.path}::${state.activeMapId || 'world'}` : null;
        if (key !== this.currentViewKey) this.restoreMapView(key);
        this.state = state;
        void this.loadBackground();
        this.rebuild();
        if (!state) this.mapRouteInitialized = false;
        else if (!this.mapRouteInitialized) {
          this.mapRouteInitialized = true;
          this.syncMapFromRoute();
        }
      });
  }

  /** Map identity belongs in the URL so browser and app history restore it. */
  private syncMapFromRoute(): void {
    if (!this.state) return;
    const requested = this.route.snapshot.queryParamMap?.get('map');
    if (requested && this.maps.some(map => map.id === requested)) {
      if (requested !== this.activeMapId) this.worldMapService.selectMap(requested);
    } else {
      void this.recordMapRoute(this.activeMapId, true);
    }
  }
  private recordMapRoute(id: string, replaceUrl = false): Promise<boolean> {
    return this.router.navigate([], { relativeTo: this.route, queryParams: { map: id }, queryParamsHandling: 'merge', replaceUrl });
  }

  get activeMapId(): string { return this.state?.activeMapId || 'world'; }
  get maps() { return this.state?.maps || (this.state ? [{ id: 'world', name: 'World map', map: this.state.map }] : []); }
  get activeMapName(): string { return this.maps.find(entry => entry.id === this.activeMapId)?.name || 'World map'; }
  mapBusy = false;
  mapForm: 'create' | 'rename' | null = null;
  deleteMapTarget: { id: string; name: string; project: string | undefined } | null = null;
  mapNameDraft = '';
  newMapTypes = new Set<string>();
  filtersOpen = false;
  readonly filterPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
  ];
  onFilterOutsideClick(event: MouseEvent): void {
    if (event.target instanceof Node && !this.filterButtonRef?.nativeElement.contains(event.target)) this.filtersOpen = false;
  }
  placementLocation: Location | null = null;
  mapFormError = '';

  private restoreMapView(key: string | null): void {
    this.cancelLocationClick();
    this.closePinMenu();
    if (this.currentViewKey) {
      WorldMapComponent.views.set(this.currentViewKey, { ...this.view });
      this.mapFilters.set(this.currentViewKey, { search: this.searchTerm, book: this.selectedBook, type: this.selectedType, picture: this.selectedPictureFilter });
    }
    const initialLegacy = !this.currentViewKey && key?.endsWith('::world');
    this.currentViewKey = key;
    const saved = key ? WorldMapComponent.views.get(key) : undefined;
    this.view = saved ? { ...saved } : { tx: 0, ty: 0, k: 1 };
    this.viewInitialized = !!saved;
    const filters = key ? this.mapFilters.get(key) : undefined;
    if (filters || !initialLegacy) {
      this.searchTerm = filters?.search || '';
      this.selectedBook = filters?.book || '';
      this.selectedType = filters?.type || '';
      this.selectedPictureFilter = filters?.picture || '';
    }
    this.cancelArea();
    this.drag = null;
    this.dragPosition = null;
    this.roadMode = false;
    this.roadFrom = this.selectedRoadKey = null;
    this.roadLabelDraft = '';
    this.placementLocation = null;
    this.placementPointer = null;
    this.filtersOpen = false;
    this.membershipOpen = false;
    this.mapForm = null;
    this.deleteMapTarget = null;
  }

  async switchMap(id: string): Promise<void> {
    if (id === this.activeMapId || this.mapBusy || this.backgroundBusy || this.areaSaving) return;
    this.mapBusy = true;
    try {
      await this.saveRoadLabel();
      // Pin the source entry before pushing the destination when opening an older URL.
      if (!this.route.snapshot.queryParamMap?.get('map') && !(await this.recordMapRoute(this.activeMapId, true))) return;
      if (await this.recordMapRoute(id)) {
        if (this.activeMapId !== id) this.worldMapService.selectMap(id);
      }
    } finally {
      this.mapBusy = false;
      this.cdr.markForCheck();
    }
  }

  async duplicateActiveMap(): Promise<void> {
    if (this.readOnly || this.mapBusy || this.backgroundBusy) return;
    const id = this.activeMapId;
    const project = this.projectService.getCurrentProject()?.path;
    this.mapBusy = true;
    try {
      await this.saveRoadLabel();
      if (this.destroyRef.destroyed || project !== this.projectService.getCurrentProject()?.path) return;
      if (!(await this.worldMapService.duplicateMap(id))) this.reportSaveFailure();
      else await this.recordMapRoute(this.activeMapId);
    } catch (error) {
      this.toasts.showError(`Could not duplicate the map: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.mapBusy = false;
      if (!this.destroyRef.destroyed) this.cdr.markForCheck();
    }
  }

  openDeleteMap(): void {
    if (this.readOnly || this.mapBusy || this.backgroundBusy || this.areaSaving || this.maps.length <= 1) return;
    this.closePinMenu();
    this.deleteMapTarget = { id: this.activeMapId, name: this.activeMapName, project: this.projectService.getCurrentProject()?.path };
  }
  get deletedMapLinkCount(): number {
    return this.locations.filter(location => location.destinationMapId === this.deleteMapTarget?.id).length;
  }
  async deleteActiveMap(): Promise<void> {
    const target = this.deleteMapTarget;
    if (!target || this.readOnly || this.mapBusy || this.backgroundBusy || this.areaSaving || this.maps.length <= 1 || target.project !== this.projectService.getCurrentProject()?.path) return;
    this.mapBusy = true;
    try {
      await this.saveRoadLabel();
      if (this.destroyRef.destroyed || target.project !== this.projectService.getCurrentProject()?.path) return;
      if (!(await this.worldMapService.deleteMap(target.id))) { this.reportSaveFailure(); return; }
      this.deleteMapTarget = null;
      await this.recordMapRoute(this.activeMapId, true);
    } finally {
      this.mapBusy = false;
      if (!this.destroyRef.destroyed) this.cdr.markForCheck();
    }
  }

  openMapForm(mode: 'create' | 'rename'): void {
    if (this.readOnly || this.mapBusy) return;
    this.mapForm = mode;
    this.mapNameDraft = mode === 'rename' ? this.activeMapName : '';
    this.mapFormError = '';
    this.newMapTypes = new Set();
  }

  get newMapMatchCount(): number { return this.locations.filter(location => this.newMapTypes.has(location.type || 'unspecified')).length; }

  toggleNewMapType(type: string): void {
    if (this.newMapTypes.has(type)) this.newMapTypes.delete(type);
    else this.newMapTypes.add(type);
  }

  async saveMapName(): Promise<void> {
    if (this.readOnly || !this.mapForm || this.mapBusy) return;
    const mode = this.mapForm;
    this.mapBusy = true;
    this.mapFormError = '';
    try {
      await this.saveRoadLabel();
      const ok = mode === 'create'
        ? await this.worldMapService.createMap(this.mapNameDraft, { types: [...this.newMapTypes], include: [], exclude: [] })
        : await this.worldMapService.renameMap(this.activeMapId, this.mapNameDraft);
      if (ok) {
        this.mapForm = null;
        if (mode === 'create') await this.recordMapRoute(this.activeMapId);
      }
      else {
        this.mapForm = mode;
        this.mapFormError = this.worldMapService.lastError || 'Could not save the map.';
      }
    } catch (error) {
      this.mapForm = mode;
      this.mapFormError = error instanceof Error ? error.message : String(error);
    } finally {
      this.mapBusy = false;
      if (!this.destroyRef.destroyed) this.cdr.markForCheck();
    }
  }

  membershipOpen = false;
  membershipSearch = '';
  membershipTypes = new Set<string>();
  private membershipIncludes = new Set<string>();
  private membershipExcludes = new Set<string>();
  membershipError = '';
  private membershipBase: WorldMap | null = null;
  readonly getTypeLabel = getLocationTypeLabel;
  readonly getTypeIcon = getLocationPlaceholderIcon;
  get membershipCandidates(): Location[] {
    const search = this.membershipSearch.trim().toLowerCase();
    return this.locations.filter(location => !search || [location.name, ...(location.aliases || [])]
      .some(name => name.toLowerCase().includes(search))).sort((a, b) => a.name.localeCompare(b.name));
  }
  get membershipDraft(): Set<string> {
    const chosen = new Set(this.membershipIncludes);
    for (const location of this.locations) if (this.membershipTypes.has(location.type || 'unspecified')) chosen.add(location.id);
    for (const id of this.membershipExcludes) chosen.delete(id);
    return chosen;
  }
  get draftUnpositionedCount(): number {
    const chosen = this.membershipDraft;
    return this.locations.filter(location => chosen.has(location.id) && !this.hasPosition(location.id)).length;
  }
  get membershipChanged(): boolean {
    if (!this.state) return false;
    const saved = mapMembership(this.state.map);
    const draft = this.draftRules();
    return (['types', 'include', 'exclude'] as const).some(key =>
      JSON.stringify([...saved[key]].sort()) !== JSON.stringify([...draft[key]].sort()));
  }
  /** Names what Apply would drop (positions, areas, roads), or '' when nothing is removed. */
  get membershipRemovalSummary(): string {
    if (!this.state || !this.membershipChanged) return '';
    const { positions, areas, roads } = mapRulesRemovals(this.state.map, this.draftRules(), this.locations);
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [positions && count(positions, 'position'), areas && count(areas, 'area'), roads && count(roads, 'road')].filter(Boolean) as string[];
    if (!parts.length) return '';
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    return `${list} will be removed`;
  }
  private draftRules(): MapMembership {
    return { types: [...this.membershipTypes], include: [...this.membershipIncludes], exclude: [...this.membershipExcludes] };
  }
  get mapLocations(): Location[] { return this.state ? this.locations.filter(location => isMapMember(this.state!.map, location)) : []; }
  get unpositionedLocations(): Location[] {
    const positioned = new Set([...(this.state?.map.pins || []).map(pin => pin.locationId), ...(this.state?.map.areas || []).map(area => area.locationId)]);
    return this.mapLocations.filter(location => !positioned.has(location.id));
  }
  hasPosition(id: string): boolean { return !!this.state?.map.pins.some(pin => pin.locationId === id) || this.hasArea(id); }
  openMembership(): void {
    if (!this.state) return;
    this.membershipBase = this.state.map;
    const rules = mapMembership(this.state.map);
    this.membershipTypes = new Set(rules.types);
    this.membershipIncludes = new Set(rules.include);
    this.membershipExcludes = new Set(rules.exclude);
    this.membershipSearch = '';
    this.membershipError = '';
    this.membershipOpen = true;
  }
  toggleMembershipType(type: string): void {
    if (this.membershipTypes.has(type)) this.membershipTypes.delete(type);
    else this.membershipTypes.add(type);
  }
  setMember(id: string, selected: boolean): void {
    const location = this.locations.find(location => location.id === id);
    const automatic = this.membershipTypes.has(location?.type || 'unspecified');
    if (selected) {
      this.membershipExcludes.delete(id);
      if (!automatic) this.membershipIncludes.add(id);
    } else {
      this.membershipIncludes.delete(id);
      if (automatic) this.membershipExcludes.add(id);
    }
  }
  async saveMembership(close = true): Promise<boolean> {
    if (this.readOnly || this.mapBusy || !this.membershipOpen) return false;
    if (this.state!.map !== this.membershipBase) {
      this.membershipError = 'This map changed while you were choosing locations. Close and reopen the panel to use the latest version.';
      return false;
    }
    if (!this.membershipChanged) {
      if (close) this.membershipOpen = false;
      return true;
    }
    this.mapBusy = true;
    try {
      const map = setMapRules(this.state!.map, this.draftRules(), this.locations);
      if (await this.worldMapService.apply(map)) {
        if (close) this.membershipOpen = false;
        this.membershipBase = this.state!.map;
        return true;
      }
      this.membershipError = this.worldMapService.lastError || 'Could not save the locations.';
      return false;
    } finally {
      this.mapBusy = false;
      if (!this.destroyRef.destroyed) this.cdr.markForCheck();
    }
  }
  async beginPlacement(location: Location): Promise<void> {
    if (this.readOnly || this.mapBusy || !this.membershipDraft.has(location.id)) return;
    if (this.membershipChanged) {
      this.membershipError = 'Apply your location changes before setting positions.';
      return;
    }
    this.cancelArea();
    this.membershipOpen = false;
    this.placementLocation = location;
    this.roadMode = false;
    this.roadFrom = null;
  }

  get readOnly(): boolean {
    return !this.state || this.state.readOnly || !!this.state.error;
  }

  get hasLocations(): boolean {
    return this.locations.length > 0;
  }

  get selectedRoad(): RoadView | null {
    return this.roads.find((r) => r.key === this.selectedRoadKey) ?? null;
  }

  get transform(): string {
    return `translate(${this.view.tx} ${this.view.ty}) scale(${this.view.k})`;
  }

  readonly getIcon = (location: Location) => getLocationMapIcon(location);

  async loadAll(force = false): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) return;
    this.isLoading = true;
    try {
      if (force) {
        this.backgroundKey = '';
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
    const byId = new Map(this.filteredLocations.filter(location => this.state && isMapMember(this.state.map, location)).map((l) => [l.id, l]));
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
        icon: getLocationMapIcon(location),
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
    this.unplaced = this.filteredLocations
      .filter((l) => this.state && isMapMember(this.state.map, l) && !placedIds.has(l.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (this.selectedRoadKey && !this.selectedRoad) this.selectedRoadKey = null;
    if (this.roadFrom && !pinById.has(this.roadFrom)) this.roadFrom = null;
    if (this.viewInitialized) this.constrainView();
    if (!this.viewInitialized && this.state && !this.isLoading) {
      this.viewInitialized = true;
      const key = this.currentViewKey;
      const initialView = this.view;
      setTimeout(() => {
        if (this.destroyRef.destroyed || key !== this.currentViewKey || this.view !== initialView || this.pinMenuTrigger?.isOpen()) return;
        if (this.state?.map.background) this.fitMap();
        else this.fitToView();
      }, 0);
    }
    this.cdr.markForCheck();
  }

  backgroundUrl: string | null = null;
  backgroundError: string | null = null;
  backgroundBusy = false;
  private backgroundKey = '';
  private backgroundGeneration = 0;
  get background() { return this.state?.map.background; }
  get backgroundVisible(): boolean { return !!this.background?.visible && !!this.backgroundUrl; }

  private async loadBackground(): Promise<void> {
    const background = this.background;
    const key = background ? `${this.projectService.getCurrentProject()?.path}/${background.file}` : '';
    if (key === this.backgroundKey) return;
    this.backgroundKey = key;
    const generation = ++this.backgroundGeneration;
    this.backgroundUrl = null;
    this.backgroundError = null;
    if (!background) return;
    try {
      const url = await this.worldMapService.backgroundImage(background);
      if (generation === this.backgroundGeneration && !this.destroyRef.destroyed) this.backgroundUrl = url;
    } catch (error) {
      if (generation === this.backgroundGeneration && !this.destroyRef.destroyed) {
        this.backgroundError = `Could not load background: ${error instanceof Error ? error.message : error}`;
      }
    } finally {
      if (!this.destroyRef.destroyed) this.cdr.markForCheck();
    }
  }

  onBackgroundImageError(): void {
    this.backgroundUrl = null;
    this.backgroundError = 'The background image could not be displayed';
  }

  get gridSpacing(): number {
    return 80 * Math.pow(10, Math.max(0, Math.ceil(Math.log10(0.5 / this.view.k))));
  }

  async uploadBackground(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // Selecting the same file again must work after a failed upload.
    if (!file || this.readOnly || this.backgroundBusy) return;
    const project = this.projectService.getCurrentProject()?.path;
    const mapId = this.activeMapId;
    this.backgroundBusy = true;
    try {
      const source = await readMapImageFile(file);
      if (this.destroyRef.destroyed || project !== this.projectService.getCurrentProject()?.path || mapId !== this.activeMapId) return;
      const saved = await this.worldMapService.importBackground(source, file.name);
      if (this.destroyRef.destroyed || project !== this.projectService.getCurrentProject()?.path || mapId !== this.activeMapId) return;
      if (saved) this.fitMap();
      else this.reportSaveFailure();
    } catch (error) {
      this.toasts.showError(`Could not upload background: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.backgroundBusy = false;
      this.cdr.markForCheck();
    }
  }

  async toggleBackground(): Promise<void> {
    await this.applyEdit(map => map.background ? {
      ...map, background: { ...map.background, visible: !map.background.visible },
    } : map);
  }

  async setBackgroundOpacity(value: string): Promise<void> {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return;
    await this.applyEdit(map => map.background ? {
      ...map, background: { ...map.background, opacity: Math.max(0, Math.min(1, opacity)) },
    } : map);
  }

  async removeBackground(): Promise<void> {
    await this.applyEdit(map => {
      const { background, ...rest } = map;
      return rest;
    });
  }

  fitMap(): void {
    const b = this.background;
    if (!b) { this.fitToView(); return; }
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    this.closePinMenu();
    const k = this.backgroundFitScale;
    this.view = { k, tx: rect.width / 2 - (b.x + b.width / 2) * k, ty: rect.height / 2 - (b.y + b.height / 2) * k };
    this.cdr.markForCheck();
  }

  /** Fit the artwork rather than assuming its authored units match screen pixels. */
  get backgroundFitScale(): number {
    const b = this.background;
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    return b && rect?.width && rect.height
      ? Math.min(Math.max(1, rect.width - 96) / b.width, Math.max(1, rect.height - 96) / b.height) : 1;
  }

  get zoomLimits(): { min: number; max: number } {
    const fit = this.backgroundFitScale;
    return this.background ? { min: fit * MIN_MAP_OVERVIEW, max: fit * MAX_MAP_DETAIL }
      : { min: MIN_EMPTY_ZOOM, max: MAX_EMPTY_ZOOM };
  }

  private clampZoom(k: number): number {
    const { min, max } = this.zoomLimits;
    return Math.max(min, Math.min(max, k));
  }

  /** Keep half the image visible, or half the viewport when zoomed into a larger image. */
  private clampPan(view: { tx: number; ty: number; k: number }) {
    const background = this.background;
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!background || !rect?.width || !rect.height) return view;
    const visibleWidth = Math.min(background.width * view.k, rect.width) / 2;
    const visibleHeight = Math.min(background.height * view.k, rect.height) / 2;
    const tx = Math.max(visibleWidth - (background.x + background.width) * view.k,
      Math.min(rect.width - visibleWidth - background.x * view.k, view.tx));
    const ty = Math.max(visibleHeight - (background.y + background.height) * view.k,
      Math.min(rect.height - visibleHeight - background.y * view.k, view.ty));
    return tx === view.tx && ty === view.ty ? view : { ...view, tx, ty };
  }

  /** Revalidate remembered cameras and changes in canvas/background dimensions. */
  private constrainView(): void {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    if (this.clampZoom(this.view.k) !== this.view.k) {
      this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1);
      this.cdr.markForCheck();
      return;
    }
    const next = this.clampPan(this.view);
    if (next !== this.view) {
      this.closePinMenu();
      this.view = next;
      this.cdr.markForCheck();
    }
  }

  get detailZoom(): number { return this.view.k / (this.background ? this.backgroundFitScale : 1); }
  get markerSize(): number { return Math.max(0.65, Math.min(1, 0.8 + 0.2 * Math.log2(this.detailZoom))); }
  get markerTransform(): string { return `scale(${this.markerSize / this.view.k})`; }
  get labelTransform(): string { return `scale(${1 / this.view.k})`; }
  get labelY(): number { return 18 * this.markerSize + 16; }

  /** Greedy collision avoidance in screen space. Selection gets first priority. */
  get visiblePinLabels(): Set<string> {
    const visible = new Set<string>();
    if (this.detailZoom < 0.7) return visible;
    const boxes: { left: number; right: number; top: number; bottom: number }[] = [];
    const pins = [...this.placed].sort((a, b) => Number(b.location.id === this.selectedLocationId) - Number(a.location.id === this.selectedLocationId));
    for (const pin of pins) {
      const x = pin.x * this.view.k + this.view.tx;
      const y = pin.y * this.view.k + this.view.ty + this.labelY;
      // Conservative text bounds, plus a gutter between neighbouring names.
      const half = Math.max(20, Array.from(pin.location.name).length * 4.5 + 8);
      const box = { left: x - half, right: x + half, top: y - 15, bottom: y + 6 };
      if (!boxes.some(b => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top)) {
        visible.add(pin.location.id);
        boxes.push(box);
      }
    }
    return visible;
  }

  // ---- Edits ---------------------------------------------------------------

  private async applyEdit(edit: (map: WorldMap) => WorldMap): Promise<boolean> {
    const state = this.worldMapService.snapshot;
    if (!state || this.readOnly) return false;
    const ok = await this.worldMapService.apply(edit(state.map));
    if (!ok) this.reportSaveFailure();
    return ok;
  }

  private reportSaveFailure(): void {
    const reason = this.worldMapService.lastError;
    this.toasts.showError(
      this.worldMapService.snapshot?.readOnly
        ? 'The world map could not be saved: this project is read-only.'
        : `The world map could not be saved${reason ? `: ${reason}` : '.'}`
    );
  }

  async unpin(locationId: string): Promise<void> {
    if (this.readOnly) return;
    if (this.roadFrom === locationId) this.roadFrom = null;
    await this.applyEdit((map) => removePin(map, locationId));
  }

  async undo(): Promise<void> {
    if (this.readOnly || !this.state?.canUndo) return;
    const previousMapId = this.activeMapId;
    if (!(await this.worldMapService.undo())) this.reportSaveFailure();
    else if (previousMapId !== this.activeMapId) await this.recordMapRoute(this.activeMapId);
  }

  async redo(): Promise<void> {
    if (this.readOnly || !this.state?.canRedo) return;
    const previousMapId = this.activeMapId;
    if (!(await this.worldMapService.redo())) this.reportSaveFailure();
    else if (previousMapId !== this.activeMapId) await this.recordMapRoute(this.activeMapId);
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
    await this.openLocation(pin.location);
  }

  destinationMap(location: Location) {
    return this.maps.find(map => map.id === location.destinationMapId);
  }
  private cancelLocationClick(): void {
    clearTimeout(this.locationClickTimer);
    this.locationClickTimer = undefined;
  }
  /** Let a double click open a destination before the drawer can shift the canvas. */
  onLocationClick(location: Location): void {
    if (this.areaLocation || this.roadMode) return;
    this.cancelLocationClick();
    if (!this.destinationMap(location) || location.destinationMapId === this.activeMapId) {
      void this.openLocation(location);
      return;
    }
    this.locationClickTimer = setTimeout(() => {
      this.locationClickTimer = undefined;
      if (!this.destroyRef.destroyed) void this.openLocation(location);
    }, 350);
  }
  async onLocationDoubleClick(location: Location, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.cancelLocationClick();
    if (this.areaLocation || this.roadMode || !location.destinationMapId) return;
    await this.openDestinationMap(location.destinationMapId);
  }
  async openDestinationMap(id: string): Promise<void> {
    this.cancelLocationClick();
    this.closePinMenu();
    if (id === this.activeMapId || !this.maps.some(map => map.id === id) || this.mapBusy || this.backgroundBusy || this.areaLocation) return;
    const project = this.projectService.getCurrentProject()?.path;
    await this.saveRoadLabel();
    if (!this.route.snapshot.queryParamMap?.get('map') && !(await this.recordMapRoute(this.activeMapId, true))) return;
    // One guarded history entry closes the drawer and opens the destination together.
    const navigated = await this.router.navigate(['/locations'], { queryParams: { map: id }, queryParamsHandling: 'merge' });
    if (!navigated || this.destroyRef.destroyed || project !== this.projectService.getCurrentProject()?.path || !this.maps.some(map => map.id === id)) return;
    if (this.activeMapId !== id) this.worldMapService.selectMap(id);
  }

  async openLocation(location: Location): Promise<void> {
    this.cancelLocationClick();
    if (this.selectedLocationId === location.id) return;
    await this.router.navigate(['/location', location.id], { queryParams: { map: this.activeMapId }, queryParamsHandling: 'merge' });
  }

  createLocation(): void {
    void this.router.navigate(['/location'], { queryParams: { map: this.activeMapId }, queryParamsHandling: 'merge' });
  }

  onPinMenuOpened(trigger: CdkContextMenuTrigger): void {
    this.cancelLocationClick();
    if (this.pinMenuTrigger && this.pinMenuTrigger !== trigger) this.closePinMenu();
    this.pinMenuTrigger = trigger;
  }

  closePinMenu(): void {
    const trigger = this.pinMenuTrigger;
    this.pinMenuTrigger = null;
    trigger?.close();
  }

  onPinMenuEscape(pin: PlacedPin, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.closePinMenu();
    const element = Array.from(this.canvasRef?.nativeElement.querySelectorAll<SVGElement>('.pin') || [])
      .find(element => element.dataset['locationId'] === pin.location.id);
    element?.focus();
  }

  async pinMenuAction(pin: PlacedPin, action: 'open' | 'center' | 'position' | 'road' | 'remove' | 'area' | 'remove-area' | 'remove-pin' | 'destination'): Promise<void> {
    this.closePinMenu();
    const current = this.placed.find(item => item.location.id === pin.location.id);
    if (!current) return;
    if (action === 'destination') {
      if (current.location.destinationMapId) await this.openDestinationMap(current.location.destinationMapId);
      return;
    }
    if (action === 'open') { await this.openLocation(current.location); return; }
    if (action === 'center') {
      const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
      if (rect) this.view = this.clampPan({ ...this.view, tx: rect.width / 2 - current.x * this.view.k, ty: rect.height / 2 - current.y * this.view.k });
      this.cdr.markForCheck();
      return;
    }
    if (this.readOnly) return;
    await this.saveRoadLabel();
    this.selectedRoadKey = null;
    this.cancelArea();
    if (action === 'area') { await this.beginArea(current.location); return; }
    if (action === 'remove-pin') { await this.removePinKeepArea(current.location.id); return; }
    if (action === 'remove-area') { await this.removeArea(current.location.id); return; }
    if (action === 'position') {
      this.placementLocation = current.location;
      this.roadMode = false;
      this.roadFrom = null;
    } else if (action === 'road') {
      this.placementLocation = null;
      this.roadMode = true;
      this.roadFrom = current.location.id;
    } else if (action === 'remove') {
      await this.unpin(current.location.id);
    }
    if (!this.destroyRef.destroyed) this.cdr.markForCheck();
  }

  /** Keyboard on a focused pin: arrows move it, Delete unpins it, Enter activates. */
  async onPinKeydown(pin: PlacedPin, event: KeyboardEvent, trigger?: CdkContextMenuTrigger): Promise<void> {
    if (trigger && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
      event.preventDefault();
      event.stopPropagation();
      const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
      this.closePinMenu();
      // Dispatch the same event as right-click so CDK also focuses the first item.
      (event.currentTarget as SVGElement).dispatchEvent(new MouseEvent('contextmenu', {
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        button: 0, bubbles: true, cancelable: true,
      }));
      return;
    }
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
    if (event.button !== 0 || this.areaLocation) return;
    this.cancelLocationClick();
    this.closePinMenu();
    event.stopPropagation();
    // Capture only once dragging starts: capturing a click here retargets dblclick to the canvas.
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
    this.cancelLocationClick();
    this.closePinMenu();
    if ((this.placementLocation || this.areaLocation) && event.button === 0) {
      this.placementPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }
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
    const pointDrag = this.areaPointDrag;
    if (pointDrag?.pointerId === event.pointerId) {
      if (this.readOnly || this.areaSaving) return;
      this.areaPoints = this.areaPoints.map((point, index) => index === pointDrag.index ? {
        x: Math.round(pointDrag.start.x + (event.clientX - pointDrag.clientX) / this.view.k),
        y: Math.round(pointDrag.start.y + (event.clientY - pointDrag.clientY) / this.view.k),
      } : point);
      this.areaError = '';
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved && drag.kind === 'pin') this.canvasRef?.nativeElement.setPointerCapture?.(event.pointerId);
    drag.moved = true;
    if (drag.kind === 'pan') {
      this.view = this.clampPan({ ...this.view, tx: drag.originTx + dx, ty: drag.originTy + dy });
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
    if (this.areaPointDrag?.pointerId === event.pointerId) {
      this.areaPointDrag = null;
      this.canvasRef?.nativeElement.releasePointerCapture?.(event.pointerId);
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    if (this.canvasRef?.nativeElement.hasPointerCapture?.(event.pointerId)) this.canvasRef.nativeElement.releasePointerCapture(event.pointerId);
    if (drag.kind === 'pan') {
      const point = this.placementPointer;
      this.placementPointer = null;
      if (this.areaLocation && !this.areaEditing && point?.id === event.pointerId && !drag.moved && !this.readOnly && !this.areaSaving) {
        if (this.areaPoints.length >= 2000) { this.areaError = 'An area supports up to 2,000 points.'; return; }
        const position = this.toWorld(event.clientX, event.clientY);
        this.areaPoints = [...this.areaPoints, { x: Math.round(position.x), y: Math.round(position.y) }];
        this.areaError = '';
        return;
      }
      if (this.placementLocation && point?.id === event.pointerId && !drag.moved && !this.readOnly && this.state && isMapMember(this.state.map, this.placementLocation)) {
        const location = this.placementLocation;
        const position = this.toWorld(event.clientX, event.clientY);
        this.placementLocation = null;
        const saved = await this.applyEdit(map => setPinPosition(map, location.id, position.x, position.y));
        if (!saved) this.placementLocation = location;
        return;
      }
      if (this.areaLocation) return;
      if (!drag.moved && this.roadMode) this.roadFrom = null;
      else if (!drag.moved && this.drawerOpen) await this.router.navigate(['/locations'], { queryParams: { map: this.activeMapId }, queryParamsHandling: 'merge' });
      return;
    }
    const pin = this.placed.find((p) => p.location.id === drag.id);
    if (!drag.moved) {
      if (pin) {
        if (this.roadMode) await this.activatePin(pin);
        else this.onLocationClick(pin.location);
      }
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
    if (this.areaPointDrag?.pointerId === event.pointerId) {
      const drag = this.areaPointDrag;
      this.areaPoints = this.areaPoints.map((point, index) => index === drag.index ? drag.start : point);
      this.areaPointDrag = null;
      return;
    }
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = null;
    this.dragPosition = null;
    this.placementPointer = null;
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
    this.closePinMenu();
    const k = this.clampZoom(this.view.k * factor);
    if (k === this.view.k) { this.view = this.clampPan(this.view); return; }
    const ratio = k / this.view.k;
    this.view = this.clampPan({ k, tx: sx - (sx - this.view.tx) * ratio, ty: sy - (sy - this.view.ty) * ratio });
  }

  fitToView(): void {
    const rect = this.canvasRef?.nativeElement.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    this.closePinMenu();
    if (this.placed.length === 0 && this.areas.length === 0) {
      if (this.background) { this.fitMap(); return; }
      this.view = { k: 1, tx: rect.width / 2, ty: rect.height / 2 };
      this.cdr.markForCheck();
      return;
    }
    const points = [...this.placed, ...this.areas.flatMap(area => area.points)];
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const k = this.clampZoom(Math.min(this.background ? Infinity : 1.5,
      Math.max(1, rect.width - 160) / Math.max(1, maxX - minX),
      Math.max(1, rect.height - 160) / Math.max(1, maxY - minY)));
    this.view = this.clampPan({
      k,
      tx: rect.width / 2 - ((minX + maxX) / 2) * k,
      ty: rect.height / 2 - ((minY + maxY) / 2) * k,
    });
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
    await this.applyEdit((map) => setPinPosition(includeMapLocation(map, id), id, x, y));
  }

  @HostListener('document:pointerdown', ['$event'])
  closeOptionsOutside(event: PointerEvent): void {
    const options = this.optionsRef?.nativeElement;
    if (options?.open && event.target instanceof Node && !options.contains(event.target)) options.open = false;
  }

  // ---- Keyboard ------------------------------------------------------------

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.optionsRef?.nativeElement.open) {
      this.optionsRef.nativeElement.open = false;
      this.optionsRef.nativeElement.querySelector('summary')?.focus();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && this.filtersOpen) {
      this.filtersOpen = false;
      event.preventDefault();
      return;
    }
    if (this.mapForm || this.membershipOpen || isEditableKeyboardTarget(event.target)) return;
    if (this.areaLocation) {
      if (event.key === 'Escape') { event.preventDefault(); this.cancelArea(); }
      else if (event.key === 'Enter' && !isInteractiveKeyboardTarget(event.target)) { event.preventDefault(); void this.finishArea(); }
      else if ((event.key === 'Backspace' || event.key === 'Delete') && !this.areaSaving) {
        event.preventDefault();
        if (this.areaEditing) this.deleteAreaPoint();
        else this.areaPoints = this.areaPoints.slice(0, -1);
      }
      return;
    }
    if (event.key === 'Escape' && this.placementLocation) {
      event.preventDefault();
      this.placementLocation = null;
      this.placementPointer = null;
      return;
    }
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
