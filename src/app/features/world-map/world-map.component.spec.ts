import { Location as BrowserLocation } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { MapRouteReuseStrategy } from '../../core/services/map-route-reuse.strategy';
import { locationEditorGuard } from '../../core/guards/location-editor.guard';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, ActivatedRoute, convertToParamMap, provideRouter, RouteReuseStrategy, NavigationEnd } from '@angular/router';
import { BehaviorSubject, Subject, firstValueFrom, filter } from 'rxjs';
import { ElectronService } from '../../core/services/electron.service';
import { FileWatcherService } from '../../core/services/file-watcher.service';
import { WorldMapComponent } from './world-map.component';
import { Location, getLocationPlaceholderIcon } from '../../core/interfaces/location.interface';
import { LocationService } from '../../core/services/location.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProjectService } from '../../core/services/project.service';
import { WorldMapService, WorldMapState } from '../../core/services/world-map.service';
import { WorldMap, setLocationArea, emptyWorldMap, parseWorldMap, parseWorldMaps, serializeWorldMap } from '../../core/utils/world-map.utils';

function loc(id: string, name: string, type?: Location['type']): Location {
  return { id, name, type, books: [], content: '', created: new Date(), modified: new Date(), relativePath: '', filePath: '' };
}

describe('WorldMapComponent', () => {
  let fixture: ComponentFixture<WorldMapComponent>;
  let component: WorldMapComponent;
  let locations$: BehaviorSubject<Location[]>;
  let state$: BehaviorSubject<WorldMapState | null>;
  let worldMap: jasmine.SpyObj<WorldMapService> & { snapshot: WorldMapState | null };
  let router: { navigate: jasmine.Spy; events: Subject<unknown> };

  const setState = (map: WorldMap, extra: Partial<WorldMapState> = {}) =>
    state$.next({ map, readOnly: false, error: null, canUndo: false, canRedo: false, ...extra });

  beforeEach(() => {
    (WorldMapComponent as any).views.clear();
    for (const key of ['locationSearchTerm', 'locationSelectedBook', 'locationSelectedType', 'locationSelectedPicture', 'mapMarkerMode']) localStorage.removeItem(key);
    locations$ = new BehaviorSubject<Location[]>([]);
    state$ = new BehaviorSubject<WorldMapState | null>(null);
    worldMap = jasmine.createSpyObj('WorldMapService', ['load', 'apply', 'undo', 'redo', 'backgroundImage', 'importBackground', 'duplicateMap', 'deleteMap', 'selectMap']) as any;
    Object.defineProperty(worldMap, 'state$', { value: state$.asObservable() });
    Object.defineProperty(worldMap, 'snapshot', { get: () => state$.value });
    worldMap.load.and.resolveTo();
    worldMap.backgroundImage.and.resolveTo('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>'));
    worldMap.apply.and.callFake(async (next: WorldMap) => {
      setState(next, { canUndo: true });
      return true;
    });
    router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true), events: new Subject() };

    TestBed.configureTestingModule({
      imports: [WorldMapComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({})), snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({ map: 'world' }), routeConfig: { path: 'locations' } } } },
        { provide: WorldMapService, useValue: worldMap },
        {
          provide: LocationService,
          useValue: {
            getLocations: () => locations$.asObservable(),
            loadLocations: async () => {},
            forceReloadLocations: async () => {},
          },
        },
        { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/vault' }) } },
        { provide: Router, useValue: router },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showError']) },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error']) },
      ],
    });
    fixture = TestBed.createComponent(WorldMapComponent);
    component = fixture.componentInstance;
  });

  const render = async () => {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const query = (sel: string): HTMLElement | null => fixture.nativeElement.querySelector(sel);

  const background = { file: 'assets/maps/coast.svg', name: 'Coast.svg', x: -50000, y: -25000,
    width: 100000, height: 50000, opacity: 0.75, visible: true };

  it('draws an area without creating a pin and supports cancellation and removal', async () => {
    const location = loc('region', 'The North', 'region');
    locations$.next([location]);
    setState(emptyWorldMap());
    await render();
    await component.beginArea(location);
    component.view = { tx: 0, ty: 0, k: 1 };
    const rect = component.canvasRef!.nativeElement.getBoundingClientRect();
    spyOn(component.canvasRef!.nativeElement, 'setPointerCapture').and.stub();
    spyOn(component.canvasRef!.nativeElement, 'releasePointerCapture').and.stub();
    for (const [x, y] of [[10, 10], [110, 10], [60, 100]]) {
      const event = new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: rect.left + x, clientY: rect.top + y });
      component.onCanvasPointerDown(event);
      await component.onCanvasPointerUp(event);

    }
    expect(component.areaPoints.length).toBe(3);
    await component.finishArea();
    await render();
    expect(state$.value!.map.pins).toEqual([]);
    expect(component.hasPosition(location.id)).toBeTrue();
    expect(component.unpositionedLocations).toEqual([]);
    expect(query('.location-area polygon')).not.toBeNull();
    expect(query('.map-empty')).toBeNull();
    await component.beginArea(location);
    component.cancelArea();
    expect(state$.value!.map.areas!.length).toBe(1);
    await component.removeArea(location.id);
    expect(state$.value!.map.areas).toEqual([]);
    expect(component.unpositionedLocations).toEqual([location]);
  });

  it('keeps area drafts on failed saves and rejects edits in read-only maps', async () => {
    const location = loc('a', 'Region');
    locations$.next([location]);
    setState(emptyWorldMap());
    await render();
    await component.beginArea(location);
    component.areaPoints = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    worldMap.apply.and.resolveTo(false);
    await component.finishArea();
    expect(component.areaLocation).toBe(location);
    component.cancelArea();
    setState(emptyWorldMap(), { readOnly: true });
    await component.beginArea(location);
    expect(component.areaLocation).toBeNull();
  });

  it('edits existing boundaries by dragging, inserting and deleting individual points', async () => {
    const location = loc('a', 'Region');
    locations$.next([location]);
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const original = setLocationArea({ ...emptyWorldMap(), pins: [{ locationId: 'a', x: 50, y: 50 }] }, 'a', points, '#123456');
    setState(original);
    await render();
    await component.beginArea(location);
    component.view = { tx: 0, ty: 0, k: 2 };
    await render();
    expect(component.areaEditing).toBeTrue();
    expect(component.areaPoints).toEqual(points);
    expect(component.areaColor).toBe('#123456');
    expect(fixture.nativeElement.querySelectorAll('.area-vertex.editable').length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.area-insert').length).toBe(4);
    spyOn(component.canvasRef!.nativeElement, 'setPointerCapture').and.stub();
    spyOn(component.canvasRef!.nativeElement, 'releasePointerCapture').and.stub();
    query('.area-vertex')!.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30, bubbles: true }));
    component.onCanvasPointerMove(new PointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 50 }));
    await component.onCanvasPointerUp(new PointerEvent('pointerup', { pointerId: 1 }));
    expect(component.areaPoints[0]).toEqual({ x: 20, y: 10 });
    expect(original.areas![0].points).toEqual(points);
    // Insert on the closing edge, then remove the inserted point.
    component.insertAreaPoint(3);
    expect(component.areaPoints[4]).toEqual({ x: 10, y: 55 });
    component.deleteAreaPoint();
    expect(component.areaPoints.length).toBe(4);
    component.onAreaPointKeydown(1, new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(component.areaPoints.length).toBe(3);
    component.deleteAreaPoint();
    expect(component.areaPoints.length).toBe(3);
    expect(worldMap.apply).not.toHaveBeenCalled();
    const edited = component.areaPoints.map(point => ({ ...point }));
    await component.finishArea();
    expect(worldMap.apply).toHaveBeenCalledTimes(1);
    expect(state$.value!.map.areas![0].points).toEqual(edited);
    expect(state$.value!.map.pins).toEqual(original.pins);
    expect(component.areaLocation).toBeNull();
  });

  it('cancels point drags and area edits without changing the saved boundary', async () => {
    const location = loc('a', 'Region');
    locations$.next([location]);
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const original = setLocationArea(emptyWorldMap(), 'a', points);
    setState(original);
    await render();
    await component.beginArea(location);
    spyOn(component.canvasRef!.nativeElement, 'setPointerCapture').and.stub();
    component.onAreaPointDown(0, new PointerEvent('pointerdown', { button: 0, pointerId: 2, clientX: 0, clientY: 0 }));
    component.onCanvasPointerMove(new PointerEvent('pointermove', { pointerId: 2, clientX: 40, clientY: 40 }));
    component.onCanvasPointerCancel(new PointerEvent('pointercancel', { pointerId: 2 }));
    expect(component.areaPoints).toEqual(points);
    component.insertAreaPoint(0);
    component.onAreaPointKeydown(0, new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    component.cancelArea();
    expect(state$.value!.map).toBe(original);
    expect(original.areas![0].points).toEqual(points);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('blocks read-only boundary changes and keeps drafts when the map changes externally', async () => {
    const location = loc('a', 'Region');
    locations$.next([location]);
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const original = setLocationArea(emptyWorldMap(), 'a', points);
    setState(original);
    await render();
    await component.beginArea(location);
    setState(original, { readOnly: true });
    expect(component.insertAreaPoint(0)).toBeNull();
    component.onAreaPointKeydown(0, new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(component.areaPoints).toEqual(points);
    setState({ ...original, notes: 'Changed externally' });
    await component.finishArea();
    expect(component.areaError).toContain('map changed');
    expect(component.areaLocation).toBe(location);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  function linkedLocationState(readOnly = false) {
    const location = { ...loc('a', 'Harbor', 'settlement'), destinationMapId: 'city' };
    locations$.next([location]);
    const map = setLocationArea({ ...emptyWorldMap(), pins: [{ locationId: 'a', x: 0, y: 0 }] }, 'a',
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }]);
    setState(map, { readOnly, activeMapId: 'world', maps: [
      { id: 'world', name: 'World map', map }, { id: 'city', name: 'City map', map: emptyWorldMap() },
    ] });
    return location;
  }

  it('opens linked maps on double-click for both pins and areas, including read-only maps', async () => {
    const location = linkedLocationState(true);
    await render();
    for (const selector of ['.pin', '.location-area polygon']) {
      component.onLocationClick(location);
      query(selector)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await render();
      expect(worldMap.selectMap).toHaveBeenCalledWith('city');
      expect(router.navigate).toHaveBeenCalledWith(['/locations'], { queryParams: { map: 'city' }, queryParamsHandling: 'merge' });
      worldMap.selectMap.calls.reset();
    }
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('keeps single-click details and cancels pending activation when clicking elsewhere', async () => {
    const location = linkedLocationState();
    await render();
    spyOn(component.canvasRef!.nativeElement, 'setPointerCapture').and.stub();
    jasmine.clock().install();
    try {
      component.onLocationClick(location);
      component.onCanvasPointerDown(new PointerEvent('pointerdown', { button: 0, pointerId: 7 }));
      component.onCanvasPointerCancel(new PointerEvent('pointercancel', { pointerId: 7 }));
      jasmine.clock().tick(400);
      expect(router.navigate).not.toHaveBeenCalled();
      component.onLocationClick(location);
      jasmine.clock().tick(400);
      expect(router.navigate).toHaveBeenCalledWith(['/location', 'a'], { queryParams: { map: 'world' }, queryParamsHandling: 'merge' });
      expect(worldMap.selectMap).not.toHaveBeenCalled();
    } finally { jasmine.clock().uninstall(); }
  });

  it('leaves icon clicks uncaptured so native double-click events can reach the icon', async () => {
    linkedLocationState();
    await render();
    const canvas = component.canvasRef!.nativeElement;
    const capture = spyOn(canvas, 'setPointerCapture').and.stub();
    const icon = query('.pin-disc')!;
    for (let i = 0; i < 2; i++) {
      icon.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
      icon.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, clientX: 50, clientY: 50, bubbles: true }));
    }
    expect(capture).not.toHaveBeenCalled();
    icon.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await render();
    expect(worldMap.selectMap).toHaveBeenCalledWith('city');
    component.onPinPointerDown(component.placed[0], new PointerEvent('pointerdown', { button: 0, pointerId: 2, clientX: 50, clientY: 50 }));
    component.onCanvasPointerMove(new PointerEvent('pointermove', { pointerId: 2, clientX: 70, clientY: 60 }));
    expect(capture).toHaveBeenCalledOnceWith(2);
    component.onCanvasPointerCancel(new PointerEvent('pointercancel', { pointerId: 2 }));
  });

  it('requires confirmation for map deletion and protects the final map', async () => {
    setState(emptyWorldMap());
    await render();
    component.openDeleteMap();
    expect(component.deleteMapTarget).toBeNull();
    linkedLocationState();
    await render();
    component.openDeleteMap();
    await render();
    expect(component.deleteMapTarget?.id).toBe('world');
    expect(fixture.nativeElement.textContent).toContain('Undo can restore this map');
    expect(worldMap.deleteMap).not.toHaveBeenCalled();
    component.deleteMapTarget = null;
    expect(worldMap.deleteMap).not.toHaveBeenCalled();
  });

  it('offers destination map navigation in both pin and area context menus', async () => {
    linkedLocationState();
    await render();
    for (const selector of ['.pin', '.location-area polygon']) {
      query(selector)!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
      await render();
      const overlay = TestBed.inject(OverlayContainer).getContainerElement();
      const button = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(item => item.textContent?.includes('Open City map'))!;
      expect(button).toBeDefined();
      button.click();
      await render();
      expect(worldMap.selectMap).toHaveBeenCalledWith('city');
      worldMap.selectMap.calls.reset();
    }
  });

  it('respects drawer navigation guards and ignores missing or current destinations', async () => {
    linkedLocationState();
    await render();
    component.drawerOpen = true;
    router.navigate.and.resolveTo(false);
    await component.openDestinationMap('city');
    expect(router.navigate).toHaveBeenCalledWith(['/locations'], { queryParams: { map: 'city' }, queryParamsHandling: 'merge' });
    expect(worldMap.selectMap).not.toHaveBeenCalled();
    router.navigate.and.resolveTo(true);
    await component.openDestinationMap('city');
    expect(worldMap.selectMap).toHaveBeenCalledOnceWith('city');
    worldMap.selectMap.calls.reset();
    await component.openDestinationMap('world');
    await component.openDestinationMap('missing');
    expect(worldMap.selectMap).not.toHaveBeenCalled();
  });

  it('renders the background beneath overlays and hides the grid and empty-state overlay', async () => {
    setState({ ...emptyWorldMap(), background });
    await render();
    expect(query('.map-background')).not.toBeNull();
    expect(query('.grid')).toBeNull();
    expect(query('.map-empty')).toBeNull();
    expect(query('.map-background')!.getAttribute('opacity')).toBe('0.75');
    await component.toggleBackground();
    await render();
    expect(query('.map-background')).toBeNull();
    expect(query('.grid')).not.toBeNull();
    await component.setBackgroundOpacity('0.4');
    expect(state$.value!.map.background!.opacity).toBe(0.4);
    await component.removeBackground();
    expect(state$.value!.map.background).toBeUndefined();
  });

  it('fits a large map without moving pins and keeps marker size bounded across zoom levels', async () => {
    locations$.next([loc('a', 'Harbor')]);
    setState({ ...emptyWorldMap(), background, pins: [{ locationId: 'a', x: 10, y: 20 }] });
    await render();
    spyOn(component.canvasRef!.nativeElement, 'getBoundingClientRect').and.returnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);
    component.fitMap();
    const pin = component.placed[0];
    expect(component.view.k * background.width).toBeLessThanOrEqual(904);
    expect(component.toWorld(500, 300)).toEqual({ x: 0, y: 0 });
    for (const k of [0.0001, 0.01, 0.15, 1, 4]) {
      component.view = { ...component.view, k };
      expect(component.markerSize * 36).toBeGreaterThanOrEqual(23.4);
      expect(component.markerSize * 36).toBeLessThanOrEqual(36);
    }
    expect(component.placed[0]).toBe(pin);
    expect(state$.value!.map.pins).toEqual([{ locationId: 'a', x: 10, y: 20 }]);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('sets background-relative zoom limits for small and huge authored maps and preserves the wheel anchor', async () => {
    setState({ ...emptyWorldMap(), background });
    await render();
    spyOn(component.canvasRef!.nativeElement, 'getBoundingClientRect').and.returnValue({ left: 10, top: 20, width: 1000, height: 600 } as DOMRect);
    for (const width of [100, 1000, 100000]) {
      setState({ ...emptyWorldMap(), background: { ...background, width, height: width / 2 } });
      component.fitMap();
      const fit = component.view.k;
      expect(component.zoomLimits.min).toBeCloseTo(fit * 0.8, 8);
      expect(component.zoomLimits.max).toBeCloseTo(fit * 64, 8);
      component.zoomBy(1e10);
      expect(component.view.k).toBeCloseTo(fit * 64, 8);
      component.zoomBy(1e-20);
      expect(component.view.k).toBeCloseTo(fit * 0.8, 8);
      component.fitMap();
      const before = component.toWorld(123, 234);
      component.onWheel(new WheelEvent('wheel', { clientX: 123, clientY: 234, deltaY: -150, cancelable: true }));
      const after = component.toWorld(123, 234);
      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
    }
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('revalidates zoom on canvas resize and background changes without moving any pins', async () => {
    locations$.next([loc('a', 'Harbor')]);
    const pin = { locationId: 'a', x: 20, y: 30 };
    setState({ ...emptyWorldMap(), background, pins: [pin] });
    await render();
    let width = 1000;
    spyOn(component.canvasRef!.nativeElement, 'getBoundingClientRect').and.callFake(() => ({ left: 0, top: 0, width, height: 600 } as DOMRect));
    component.fitMap();
    component.zoomBy(1e-10);
    width = 1800;
    window.dispatchEvent(new Event('resize'));
    component.rebuild();
    expect(component.view.k).toBeGreaterThanOrEqual(component.zoomLimits.min);
    component.zoomBy(1e10);
    setState({ ...emptyWorldMap(), background: { ...background, width: 1_000_000, height: 500_000 }, pins: [pin] });
    expect(component.view.k).toBeLessThanOrEqual(component.zoomLimits.max);
    component.fitToView();
    expect(component.view.k).toBeLessThanOrEqual(component.zoomLimits.max);
    expect(state$.value!.map.pins).toEqual([pin]);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('keeps half the image or viewport visible when panning, including offset images at high zoom', async () => {
    const bg = { ...background, x: -350, y: 120, width: 1000, height: 500 };
    setState({ ...emptyWorldMap(), background: bg });
    await render();
    spyOn(component.canvasRef!.nativeElement, 'getBoundingClientRect').and.returnValue({ left: 10, top: 20, width: 800, height: 600 } as DOMRect);
    for (const multiplier of [0.8, 1, 16, 64]) {
      component.fitMap();
      component.zoomBy(multiplier);
      const k = component.view.k;
      const pan = async (dx: number, dy: number) => {
        component.onCanvasPointerDown({ button: 0, pointerId: 1, clientX: 100, clientY: 100 } as PointerEvent);
        component.onCanvasPointerMove({ pointerId: 1, clientX: 100 + dx, clientY: 100 + dy } as PointerEvent);
        await component.onCanvasPointerUp({ pointerId: 1, clientX: 100 + dx, clientY: 100 + dy } as PointerEvent);
      };
      await pan(1e9, 1e9);
      expect(bg.x * k + component.view.tx).toBeCloseTo(800 - Math.min(bg.width * k, 800) / 2, 6);
      expect(bg.y * k + component.view.ty).toBeCloseTo(600 - Math.min(bg.height * k, 600) / 2, 6);
      await pan(-1e9, -1e9);
      expect((bg.x + bg.width) * k + component.view.tx).toBeCloseTo(Math.min(bg.width * k, 800) / 2, 6);
      expect((bg.y + bg.height) * k + component.view.ty).toBeCloseTo(Math.min(bg.height * k, 600) / 2, 6);
    }
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('revalidates pan bounds after zoom, resize and background changes without moving stored pins', async () => {
    const pin = { locationId: 'a', x: 10, y: 20 };
    locations$.next([loc('a', 'Harbor')]);
    setState({ ...emptyWorldMap(), background, pins: [pin] });
    await render();
    let width = 1000;
    let height = 600;
    spyOn(component.canvasRef!.nativeElement, 'getBoundingClientRect').and.callFake(() => ({ left: 0, top: 0, width, height } as DOMRect));
    component.fitMap();
    component.view = { ...component.view, tx: 1e9, ty: -1e9 };
    component.zoomBy(2);
    expect(component.view.tx).toBeCloseTo(width / 2 + background.width * component.view.k / 2);
    expect(component.view.ty).toBeCloseTo(height / 2 - background.height * component.view.k / 2);
    width = 500; height = 300;
    component.rebuild();
    expect(component.view.tx).toBeCloseTo(width / 2 + background.width * component.view.k / 2);
    const moved = { ...background, x: 20000, y: 50000 };
    setState({ ...emptyWorldMap(), background: moved, pins: [pin] });
    const left = moved.x * component.view.k + component.view.tx;
    const right = left + moved.width * component.view.k;
    const top = moved.y * component.view.k + component.view.ty;
    const bottom = top + moved.height * component.view.k;
    expect(left).toBeLessThanOrEqual(width - Math.min(moved.width * component.view.k, width) / 2 + 0.000001);
    expect(right).toBeGreaterThanOrEqual(Math.min(moved.width * component.view.k, width) / 2 - 0.000001);
    expect(top).toBeLessThanOrEqual(height - Math.min(moved.height * component.view.k, height) / 2 + 0.000001);
    expect(bottom).toBeGreaterThanOrEqual(Math.min(moved.height * component.view.k, height) / 2 - 0.000001);
    expect(state$.value!.map.pins).toEqual([pin]);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('keeps panning unrestricted on maps without a background', async () => {
    setState(emptyWorldMap());
    await render();
    component.view = { tx: 0, ty: 0, k: 1 };
    component.onCanvasPointerDown({ button: 0, pointerId: 1, clientX: 0, clientY: 0 } as PointerEvent);
    component.onCanvasPointerMove({ pointerId: 1, clientX: 100000, clientY: -100000 } as PointerEvent);
    expect(component.view.tx).toBe(100000);
    expect(component.view.ty).toBe(-100000);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  const menu = (): HTMLElement | null => TestBed.inject(OverlayContainer).getContainerElement().querySelector('.pin-context-menu');
  const menuItem = (text: string): HTMLButtonElement => Array.from(menu()!.querySelectorAll('button')).find(button => button.textContent?.includes(text))!;
  const openPinMenu = async (readOnly = false) => {
    locations$.next([loc('a', 'Harbor', 'settlement'), loc('b', 'Castle', 'building')]);
    setState({ ...emptyWorldMap(), pins: [{ locationId: 'a', x: 10, y: 20 }, { locationId: 'b', x: 100, y: 200 }], roads: [{ from: 'a', to: 'b' }] }, { readOnly });
    await render();
    const event = new MouseEvent('contextmenu', { button: 2, clientX: window.innerWidth - 2, clientY: window.innerHeight - 2, bubbles: true, cancelable: true });
    query('.pin-icon')!.dispatchEvent(event);
    expect(menu()).withContext('Menu immediately after contextmenu').not.toBeNull();
    await render();
    expect(event.defaultPrevented).toBeTrue();
  };

  it('opens an icon context menu inside the viewport without editing or panning the map', async () => {
    await openPinMenu();
    expect(menu()!.textContent).toContain('Harbor');
    expect(menu()!.querySelectorAll('[role="menuitem"]').length).toBe(6);
    expect(menu()!.textContent).toContain('Draw area');
    const bounds = menu()!.getBoundingClientRect();
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    expect(worldMap.apply).not.toHaveBeenCalled();
    menuItem('Open details').click();
    await render();
    expect(router.navigate).toHaveBeenCalledWith(['/location', 'a'], { queryParams: { map: 'world' }, queryParamsHandling: 'merge' });
    expect(menu()).toBeNull();
  });

  it('repositions from the pin menu only after a deliberate map click', async () => {
    await openPinMenu();
    menuItem('Reposition').click();
    await render();
    expect(menu()).toBeNull();
    expect(component.placementLocation?.id).toBe('a');
    expect(state$.value!.map.pins[0]).toEqual({ locationId: 'a', x: 10, y: 20 });
    expect(worldMap.apply).not.toHaveBeenCalled();
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.placementLocation).toBeNull();
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('offers conversion to an area-only location from the pin menu', async () => {
    await openPinMenu();
    component.closePinMenu();
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    setState(setLocationArea(state$.value!.map, 'a', points));
    await render();
    query('.pin-icon')!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
    await render();
    menuItem('Remove pin, keep area').click();
    await render();
    expect(menu()).toBeNull();
    expect(state$.value!.map.pins.map(pin => pin.locationId)).toEqual(['b']);
    expect(state$.value!.map.areas![0].points).toEqual(points);
    expect(component.mapLocations.map(location => location.id)).toContain('a');
    expect(component.unpositionedLocations).toEqual([]);
    expect(query('.location-area polygon')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.pin[data-location-id="a"]')).toBeNull();
    setState(setLocationArea({ ...state$.value!.map, pins: [{ locationId: 'a', x: 10, y: 20 }] }, 'a', points), { readOnly: true });
    worldMap.apply.calls.reset();
    await component.removePinKeepArea('a');
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('starts a road from the chosen pin and removes only that map placement', async () => {
    await openPinMenu();
    menuItem('Draw road').click();
    await render();
    expect(component.roadMode).toBeTrue();
    expect(component.roadFrom).toBe('a');
    expect(worldMap.apply).not.toHaveBeenCalled();
    query('.pin-icon')!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
    await render();
    menuItem('Remove from this map').click();
    await render();
    expect(state$.value!.map.pins).toEqual([{ locationId: 'b', x: 100, y: 200 }]);
    expect(state$.value!.map.roads).toEqual([]);
    expect(component.locations.length).toBe(2);
  });

  it('allows read-only pin navigation while disabling map edits', async () => {
    await openPinMenu(true);
    expect(menuItem('Reposition').disabled).toBeTrue();
    expect(menuItem('Draw road').disabled).toBeTrue();
    expect(menuItem('Remove from this map').disabled).toBeTrue();
    expect(menuItem('Open details').disabled).toBeFalse();
    menuItem('Remove from this map').click();
    expect(worldMap.apply).not.toHaveBeenCalled();
    menuItem('Center on location').click();
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('supports keyboard context-menu activation and closes the menu when zooming', async () => {
    await openPinMenu();
    component.closePinMenu();
    await render();
    const pin = query('.pin')!;
    pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await render();
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(menuItem('Open details'));
    menuItem('Open details').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    await render();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(pin);
    pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
    await render();
    expect(menu()).not.toBeNull();
    component.zoomBy(1.25);
    await render();
    expect(menu()).toBeNull();
  });

  it('suppresses overlapping and overview labels while keeping hover, focus and selection available', async () => {
    locations$.next([loc('a', 'Harbor'), loc('b', 'Nearby'), loc('c', 'Far away')]);
    setState({ ...emptyWorldMap(), pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 5, y: 0 }, { locationId: 'c', x: 300, y: 0 }] });
    await render();
    component.view.k = 1;
    expect(component.visiblePinLabels).toEqual(new Set(['a', 'c']));
    component.view.k = 0.2;
    expect(component.visiblePinLabels.size).toBe(0);
    await render();
    expect(query('.pin text')).not.toBeNull(); // Retained for CSS hover/focus/selection.
  });

  it('reports missing backgrounds without losing pins or disabling map editing', async () => {
    worldMap.backgroundImage.and.rejectWith(new Error('ENOENT'));
    locations$.next([loc('a', 'Harbor')]);
    setState({ ...emptyWorldMap(), background, pins: [{ locationId: 'a', x: 5, y: 8 }] });
    await render();
    expect(component.backgroundError).toContain('ENOENT');
    expect(component.readOnly).toBeFalse();
    expect(query('.pin')).not.toBeNull();
    expect(query('.grid')).not.toBeNull();
  });

  it('uploads the selected SVG and resets the file picker, and blocks read-only uploads', async () => {
    setState(emptyWorldMap());
    await render();
    worldMap.importBackground.and.resolveTo(true);
    const input = { files: [new File(['<svg/>'], 'Coast.svg')], value: 'Coast.svg' };
    await component.uploadBackground({ target: input } as unknown as Event);
    expect(input.value).toBe('');
    expect(worldMap.importBackground).toHaveBeenCalledWith('<svg/>', 'Coast.svg');
    expect(component.backgroundBusy).toBeFalse();
    worldMap.importBackground.calls.reset();
    setState(emptyWorldMap(), { readOnly: true });
    await component.uploadBackground({ target: input } as unknown as Event);
    expect(worldMap.importBackground).not.toHaveBeenCalled();
  });

  it('offers raster formats in the picker and reads PNG uploads as binary image data', async () => {
    setState(emptyWorldMap());
    await render();
    worldMap.importBackground.and.resolveTo(true);
    const picker = query('input[type="file"]') as HTMLInputElement;
    for (const extension of ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']) expect(picker.accept).toContain(extension);
    const canvas = document.createElement('canvas');
    const url = canvas.toDataURL('image/png');
    const file = new File([Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0))], 'Map.png', { type: 'image/png' });
    await component.uploadBackground({ target: { files: [file], value: 'Map.png' } } as unknown as Event);
    expect(worldMap.importBackground).toHaveBeenCalledWith(url, 'Map.png');
  });

  it('keeps the current background when an upload fails', async () => {
    setState({ ...emptyWorldMap(), background });
    await render();
    worldMap.importBackground.and.rejectWith(new Error('Invalid SVG'));
    const input = { files: [new File(['bad'], 'Bad.svg')], value: 'Bad.svg' };
    await component.uploadBackground({ target: input } as unknown as Event);
    expect(component.background).toEqual(background);
    expect(TestBed.inject(NotificationService).showError).toHaveBeenCalledWith(jasmine.stringContaining('Invalid SVG'));
    expect(component.backgroundBusy).toBeFalse();
  });

  it('keeps the map name form and membership list within a narrow dialog', async () => {
    locations$.next([loc('a', 'A very long location name '.repeat(12), 'settlement')]);
    setState(emptyWorldMap());
    await render();
    const assertFits = () => {
      const dialog = query('.modal-dialog')!;
      dialog.style.width = '320px';
      dialog.style.fontSize = '24px';
      const body = query('.modal-body')!;
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
    };
    component.openMapForm('create');
    await render();
    assertFits();
    component.mapForm = null;
    component.openMembership();
    await render();
    assertFits();
    const row = query('.membership-location')!;
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  });

  it('filters the map and roads together without deleting hidden pins when placing matches', async () => {
    const a = { ...loc('a', 'Harbor', 'settlement'), aliases: ['Port'], content: 'On the coast', thumbnail: 'harbor.png' };
    locations$.next([a, loc('b', 'Castle', 'building'), loc('c', 'Village', 'settlement')]);
    setState({ pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 200, y: 0 }], roads: [{ from: 'a', to: 'b' }], notes: '' });
    await render();
    component.searchTerm = 'port';
    component.filtersChanged();
    expect(component.placed.map(pin => pin.location.id)).toEqual(['a']);
    expect(component.roads).toEqual([]);
    expect(state$.value!.map.pins.length).toBe(2);
    component.searchTerm = '';
    component.selectedType = 'settlement';
    component.selectedPictureFilter = 'without';
    component.filtersChanged();
    expect(component.filteredLocations.map(location => location.id)).toEqual(['c']);
    component.openMembership();
    component.setMember('c', true);
    await component.saveMembership();
    expect(state$.value!.map.pins.map(pin => pin.locationId)).toEqual(['a', 'b']);
    expect(component.mapLocations.map(location => location.id)).toEqual(['a', 'b', 'c']);
    component.clearFilters();
    expect(component.placed.length).toBe(2);
  });

  it('uses custom icons and renders location images with an icon fallback', async () => {
    const a = { ...loc('a', 'Harbor', 'settlement'), mapIcon: 'star', thumbnail: 'harbor.png' };
    const locations = TestBed.inject(LocationService) as any;
    locations.loadThumbnailForLocation = jasmine.createSpy().and.resolveTo('data:image/png;base64,aA==');
    locations$.next([a]);
    setState({ pins: [{ locationId: 'a', x: 0, y: 0 }], roads: [], notes: '' });
    await render();
    expect(component.placed[0].icon).toBe('assets/ui-icons.svg#star');
    expect(query('.pin image')).not.toBeNull();
    component.setMarkerMode('icon');
    await render();
    expect(query('.pin image')).toBeNull();
    expect(query('.pin-icon')?.getAttribute('href')).toBe('assets/ui-icons.svg#star');
    component.setMarkerMode('image');
    await render();
    expect(query('.pin image')).not.toBeNull();
    locations.loadThumbnailForLocation.and.resolveTo(null);
    locations$.next([{ ...a }]);
    await render();
    expect(query('.pin image')).toBeNull();
    expect(query('.pin-icon')?.getAttribute('href')).toBe('assets/ui-icons.svg#star');
  });

  it('shows a clear empty state with 0 locations and no crash', async () => {
    setState(emptyWorldMap());
    await render();
    expect(query('[data-testid="empty-no-locations"]')).not.toBeNull();
    expect(query('.pin')).toBeNull();
  });

  it('keeps the default toolbar compact and moves secondary settings into a closed menu', async () => {
    setState(emptyWorldMap());
    await render();
    const root = fixture.nativeElement as HTMLElement;
    root.style.width = '1000px';
    const toolbar = query('.map-toolbar')!;
    expect(toolbar.getBoundingClientRect().height).toBeLessThanOrEqual(70);
    const picker = query('#active-map')!;
    expect(picker.nextElementSibling).toBe(query('.map-options'));
    expect(picker.nextElementSibling!.nextElementSibling!.getAttribute('aria-label')).toBe('New map');
    expect(toolbar.querySelector('[aria-label="Draw roads"]')).toBeNull();
    const label = query('.locations-label')!;
    expect(label.textContent).toBe('Manage Locations');
    expect(getComputedStyle(label).display).not.toBe('none');
    root.style.width = '600px';
    expect(getComputedStyle(label).display).toBe('none');
    expect(query('.locations-trigger')!.getAttribute('aria-label')).toBe('Manage Locations');
    root.style.width = '1400px';
    const outside = Array.from(toolbar.querySelectorAll<HTMLElement>('.map-inline-action'));
    const inside = Array.from(toolbar.querySelectorAll<HTMLElement>('.map-overflow-action'));
    expect(outside.length).toBe(3);
    expect(inside.length).toBe(3);
    outside.forEach(action => expect(getComputedStyle(action).display).not.toBe('none'));
    expect(toolbar.getBoundingClientRect().height).toBeLessThanOrEqual(70);
    inside.forEach(action => expect(getComputedStyle(action).display).toBe('none'));
    root.style.width = '700px';
    outside.forEach(action => expect(getComputedStyle(action).display).toBe('none'));
    inside.forEach(action => expect(getComputedStyle(action).display).not.toBe('none'));
    expect(query('.map-options summary use')!.getAttribute('href')).toBe('assets/ui-icons.svg#settings');
    root.style.width = '1000px';
    expect(query('.map-options-panel')!.getBoundingClientRect().height).toBe(0);
    expect(query('.map-switcher')).toBeNull();
    expect(query('.background-controls')).toBeNull();
    expect(query('.unplaced-picker')).toBeNull();
    expect(query('[data-testid="pin-all"]')).toBeNull();
    const options = query('.map-options') as HTMLDetailsElement;
    options.open = true;
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(options.open).toBeFalse();
  });

  it('anchors the filter popup below its button and closes it with the same button', async () => {
    setState(emptyWorldMap());
    await render();
    (fixture.nativeElement as HTMLElement).style.width = '600px';
    const trigger = query('[aria-label="Filter this map"]')!;
    trigger.click();
    await render();
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const panel = overlay.querySelector<HTMLElement>('.map-filter-panel')!;
    expect(panel).not.toBeNull();
    expect(query('.map-stage .map-filter-panel')).toBeNull();
    const triggerBounds = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    expect(bounds.top).toBeCloseTo(triggerBounds.bottom + 8, 0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth + 1);
    trigger.click();
    await render();
    expect(overlay.querySelector('.map-filter-panel')).toBeNull();
  });

  it('includes matching types automatically without inventing positions or moving pins', async () => {
    locations$.next([loc('a', 'Grey Harbor', 'settlement'), loc('b', 'Aldmere', 'country')]);
    setState({ ...emptyWorldMap(), membership: { types: ['settlement'], include: [], exclude: [] } });
    await render();
    expect(component.unpositionedLocations.map(location => location.id)).toEqual(['a']);
    expect(query('.position-queue')!.textContent).toContain('1 to position');
    expect(query('.unplaced-picker')).toBeNull();
    expect(query('[data-testid="pin-all"]')).toBeNull();
    expect(query('.pin')).toBeNull();
    locations$.next([loc('a', 'Grey Harbor', 'settlement'), loc('b', 'Aldmere', 'country'), loc('c', 'New Town', 'settlement')]);
    await render();
    expect(component.mapLocations.map(location => location.id)).toEqual(['a', 'c']);
    expect(component.unpositionedLocations.length).toBe(2);
    expect(state$.value!.map.pins).toEqual([]);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('places a member only at a deliberate click, with Escape cancelling without saving', async () => {
    const a = loc('a', 'Harbor', 'settlement');
    locations$.next([a]);
    setState({ ...emptyWorldMap(), membership: { types: ['settlement'], include: [], exclude: [] } });
    await render();
    spyOn(component.canvasRef!.nativeElement, 'getBoundingClientRect').and.returnValue({ left: 10, top: 20, width: 800, height: 600 } as DOMRect);
    component.view = { tx: 100, ty: 100, k: 2 };
    component.openMembership();
    await component.beginPlacement(a);
    expect(component.membershipOpen).toBeFalse();
    expect(worldMap.apply).not.toHaveBeenCalled();
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.placementLocation).toBeNull();
    expect(worldMap.apply).not.toHaveBeenCalled();
    component.openMembership();
    await component.beginPlacement(a);
    component.onCanvasPointerDown({ button: 0, pointerId: 1, clientX: 210, clientY: 320 } as PointerEvent);
    await component.onCanvasPointerUp({ pointerId: 1, clientX: 210, clientY: 320 } as PointerEvent);
    expect(state$.value!.map.pins).toEqual([{ locationId: 'a', x: 50, y: 100 }]);
    expect(worldMap.apply).toHaveBeenCalledTimes(1);
    expect(component.placementLocation).toBeNull();
  });

  it('uses the same click-to-position flow from the location details instead of inventing a centre position', async () => {
    const a = loc('a', 'Harbor', 'settlement');
    locations$.next([a]);
    setState(emptyWorldMap());
    await render();
    component.details = { location: a } as any;
    await component.changePlacement(true);
    expect(component.placementLocation).toBe(a);
    expect(component.mapLocations.map(location => location.id)).toEqual(['a']);
    expect(state$.value!.map.pins).toEqual([]);
  });

  it('does not apply pending rule changes implicitly when starting placement', async () => {
    const a = loc('a', 'Harbor', 'settlement');
    locations$.next([a]);
    setState(emptyWorldMap());
    await render();
    component.openMembership();
    component.toggleMembershipType('settlement');
    await component.beginPlacement(a);
    expect(component.membershipOpen).toBeTrue();
    expect(component.membershipError).toContain('Apply');
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('draws pins with the same type icons as the Locations list', async () => {
    locations$.next([loc('a', 'Grey Harbor', 'settlement'), loc('c', 'Nowhere')]);
    setState({ pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'c', x: 50, y: 0 }, { locationId: 'deleted', x: 9, y: 9 }], roads: [], notes: '' });
    await render();
    const icons = Array.from(fixture.nativeElement.querySelectorAll('.pin .pin-icon')).map((el: any) => el.getAttribute('href'));
    expect(icons).toEqual([getLocationPlaceholderIcon('settlement'), getLocationPlaceholderIcon(undefined)]);
  });

  it('opens the location when a pin is clicked without dragging', async () => {
    locations$.next([loc('a', 'Grey Harbor')]);
    setState({ pins: [{ locationId: 'a', x: 0, y: 0 }], roads: [], notes: '' });
    await render();
    const pin = component.placed[0];
    component.onPinPointerDown(pin, { button: 0, pointerId: 1, clientX: 10, clientY: 10, stopPropagation() {} } as any);
    await component.onCanvasPointerUp({ pointerId: 1, clientX: 11, clientY: 10 } as any);
    expect(router.navigate).toHaveBeenCalledWith(['/location', 'a'], { queryParams: { map: 'world' }, queryParamsHandling: 'merge' });
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('saves the new position after dragging a pin', async () => {
    locations$.next([loc('a', 'Grey Harbor')]);
    setState({ pins: [{ locationId: 'a', x: 0, y: 0 }], roads: [], notes: '' });
    await render();
    component.view = { tx: 0, ty: 0, k: 2 };
    component.onPinPointerDown(component.placed[0], { button: 0, pointerId: 1, clientX: 0, clientY: 0, stopPropagation() {} } as any);
    component.onCanvasPointerMove({ pointerId: 1, clientX: 40, clientY: -20 } as any);
    await component.onCanvasPointerUp({ pointerId: 1, clientX: 40, clientY: -20 } as any);
    const saved = worldMap.apply.calls.mostRecent().args[0] as WorldMap;
    expect(saved.pins).toEqual([{ locationId: 'a', x: 20, y: -10 }]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('connects two pins with a road in road mode', async () => {
    locations$.next([loc('a', 'A'), loc('b', 'B')]);
    setState({ pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }], roads: [], notes: '' });
    await render();
    component.toggleRoadMode();
    await component.activatePin(component.placed[0]);
    await component.activatePin(component.placed[1]);
    expect((worldMap.apply.calls.mostRecent().args[0] as WorldMap).roads).toEqual([{ from: 'a', to: 'b' }]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  for (const key of ['Delete', 'Backspace']) {
    for (const connected of [false, true]) {
      it(`${key} on a focused pin removes only that pin and its own roads (connected: ${connected})`, async () => {
        locations$.next([loc('a', 'A'), loc('b', 'B'), loc('c', 'C')]);
        const unrelatedRoad = { from: 'a', to: 'b', label: 'Coast road' };
        const map: WorldMap = {
          pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }, { locationId: 'c', x: 200, y: 0 }],
          roads: connected ? [unrelatedRoad, { from: 'b', to: 'c' }] : [unrelatedRoad],
          notes: 'Keep map notes',
        };
        setState(map);
        await render();
        query('.road')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await render();
        const pin = query('.pin[data-location-id="c"]')!;
        pin.focus();
        expect(document.activeElement).toBe(pin);
        expect(component.selectedRoadKey).not.toBeNull();
        pin.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await render();

        expect(worldMap.apply).toHaveBeenCalledOnceWith({
          ...map, pins: map.pins.slice(0, 2), roads: [unrelatedRoad],
        });
        expect(state$.value!.map.roads).toEqual([unrelatedRoad]);
      });
    }

    it(`${key} on the document still deletes the selected road in one edit`, async () => {
      locations$.next([loc('a', 'A'), loc('b', 'B')]);
      const map: WorldMap = {
        pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }],
        roads: [{ from: 'a', to: 'b' }], notes: '',
      };
      setState(map);
      await render();
      query('.road')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await render();
      expect(worldMap.apply).toHaveBeenCalledOnceWith({ ...map, roads: [] });
    });
  }

  const selectLabeledRoad = async () => {
    locations$.next([loc('a', 'A'), loc('b', 'B'), loc('c', 'C')]);
    setState({
      pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }, { locationId: 'c', x: 200, y: 0 }],
      roads: [{ from: 'a', to: 'b', label: 'Old label' }, { from: 'b', to: 'c' }], notes: '',
    });
    await render();
    component.selectRoad(component.roads[0]);
    await render();
    component.roadLabelDraft = 'Cliff path, 2 days';
  };

  for (const button of [0, 1]) {
    it(`saves a road label before background pointerdown and late blur (button ${button})`, async () => {
      await selectLabeledRoad();
      const input = query('[data-testid="road-panel"] input')!;
      spyOn(component.canvasRef!.nativeElement, 'setPointerCapture');
      spyOn(component.canvasRef!.nativeElement, 'releasePointerCapture');
      query('.map-canvas')!.dispatchEvent(new PointerEvent('pointerdown', { button, pointerId: 1 }));
      input.dispatchEvent(new FocusEvent('blur'));
      expect(worldMap.apply).toHaveBeenCalledTimes(1);
      expect((worldMap.apply.calls.mostRecent().args[0] as WorldMap).roads[0].label).toBe('Cliff path, 2 days');
      expect(component.selectedRoadKey).toBeNull();
      component.onCanvasPointerMove({ pointerId: 1, clientX: 40, clientY: 20 } as PointerEvent);
      await component.onCanvasPointerUp({ pointerId: 1 } as PointerEvent);
      await render();
      expect(query('.road-label')?.textContent).toBe('Cliff path, 2 days');
      expect(worldMap.apply).toHaveBeenCalledTimes(1);
    });
  }

  it('saves and closes on Escape from the label input', async () => {
    await selectLabeledRoad();
    query('[data-testid="road-panel"] input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(worldMap.apply).toHaveBeenCalledTimes(1);
    expect(component.selectedRoadKey).toBeNull();
    expect(query('.road-label')?.textContent).toBe('Cliff path, 2 days');
  });

  it('saves before Escape dismisses a road selected outside the input', async () => {
    await selectLabeledRoad();
    component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(worldMap.apply).toHaveBeenCalledTimes(1);
    expect(component.selectedRoadKey).toBeNull();
  });

  it('saves the previous road when selecting another road without blur', async () => {
    await selectLabeledRoad();
    component.selectRoad(component.roads[1]);
    expect((worldMap.apply.calls.mostRecent().args[0] as WorldMap).roads[0].label).toBe('Cliff path, 2 days');
    expect(component.roadLabelDraft).toBe('');
    expect(component.selectedRoad?.from.location.id).toBe('b');
  });

  it('commits a changed label before removing its road so Undo can restore it', async () => {
    await selectLabeledRoad();
    await component.deleteSelectedRoad();
    expect(worldMap.apply).toHaveBeenCalledTimes(2);
    expect((worldMap.apply.calls.argsFor(0)[0] as WorldMap).roads[0].label).toBe('Cliff path, 2 days');
    expect((worldMap.apply.calls.argsFor(1)[0] as WorldMap).roads).toEqual([{ from: 'b', to: 'c' }]);
  });

  it('does not create an Undo step when dismissing an unchanged label', async () => {
    await selectLabeledRoad();
    component.roadLabelDraft = '  Old label  ';
    component.onCanvasPointerDown({ button: 0, pointerId: 1 } as PointerEvent);
    await component.saveRoadLabel();
    expect(worldMap.apply).not.toHaveBeenCalled();
  });

  it('shows a read-only state and does not edit', async () => {
    locations$.next([loc('a', 'Grey Harbor')]);
    setState(emptyWorldMap(), { readOnly: true });
    await render();
    expect(query('[data-testid="read-only-banner"]')).not.toBeNull();
    expect(query('[data-testid="pin-all"]')).toBeNull();
    component.openMembership();
    component.toggleMembershipType('settlement');
    await component.saveMembership();
    expect(worldMap.apply).not.toHaveBeenCalled();
  });
});

// Exercise the component with the real persistence and history service, using an
// in-memory IPC filesystem so no project files are touched.
describe('WorldMapComponent persistence and history', () => {
  let fixture: ComponentFixture<WorldMapComponent>;
  let component: WorldMapComponent;
  let service: WorldMapService;
  let electron: jasmine.SpyObj<ElectronService>;
  let disk: string;

  beforeEach(async () => {
    (WorldMapComponent as any).views.clear();
    const locations = [loc('a', 'A'), loc('b', 'B'), loc('c', 'C')];
    disk = serializeWorldMap({
      pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }],
      roads: [{ from: 'a', to: 'b', label: 'Old label' }], notes: '',
    });
    electron = jasmine.createSpyObj('ElectronService', ['fileExists', 'readFile', 'writeFileAtomic', 'isWritable']);
    electron.fileExists.and.resolveTo(true);
    electron.isWritable.and.resolveTo(true);
    electron.readFile.and.callFake(async () => ({ success: true, content: disk }));
    electron.writeFileAtomic.and.callFake(async (_path: string, content: string) => {
      disk = content;
      return { success: true };
    });
    TestBed.configureTestingModule({
      imports: [WorldMapComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({})), snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({ map: 'world' }), routeConfig: { path: 'locations' } } } },
        WorldMapService,
        { provide: ElectronService, useValue: electron },
        { provide: FileWatcherService, useValue: { fileChanges$: new Subject() } },
        { provide: LocationService, useValue: {
          getLocations: () => new BehaviorSubject(locations),
          getLocationsSnapshot: () => locations,
          loadLocations: async () => {},
        } },
        { provide: ProjectService, useValue: {
          currentProject$: new BehaviorSubject({ path: '/vault', metadata: {} }),
          getCurrentProject: () => ({ path: '/vault' }),
        } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.resolveTo(true), events: new Subject() } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showError']) },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error']) },
      ],
    });
    service = TestBed.inject(WorldMapService);
    await service.load();
    fixture = TestBed.createComponent(WorldMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('creates and renames maps through the UI while preserving the original map', async () => {
    const original = service.snapshot!.map;
    component.openMapForm('create');
    component.mapNameDraft = 'Capital City';
    await component.saveMapName();
    fixture.detectChanges();
    expect(component.activeMapName).toBe('Capital City');
    expect(component.placed).toEqual([]);
    expect(component.mapForm).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('#active-map option').length).toBe(2);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#active-map').value).toBe(component.activeMapId);
    component.openMapForm('rename');
    component.mapNameDraft = 'The Capital';
    await component.saveMapName();
    expect(component.activeMapName).toBe('The Capital');
    await component.switchMap('world');
    expect(service.snapshot!.map).toEqual(original);
    expect(parseWorldMaps(disk).collection.maps[1].name).toBe('The Capital');
  });

  it('deletes a map through confirmation, updates the URL and lets Undo restore it', async () => {
    await service.createMap('City');
    const cityId = service.snapshot!.activeMapId!;
    component.openDeleteMap();
    expect(component.deleteMapTarget?.id).toBe(cityId);
    await component.deleteActiveMap();
    expect(component.maps.length).toBe(1);
    expect(component.activeMapId).toBe('world');
    expect(component.deleteMapTarget).toBeNull();
    expect(parseWorldMaps(disk).collection.maps.length).toBe(1);
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { map: 'world' }, replaceUrl: true }));
    await component.undo();
    expect(component.activeMapId).toBe(cityId);
    expect(component.maps.length).toBe(2);
  });

  it('duplicates through the toolbar action while preserving the source and selecting the copy', async () => {
    const original = service.snapshot!.map;
    await component.duplicateActiveMap();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.activeMapName).toBe('World map copy');
    expect(service.snapshot!.map).toEqual(original);
    expect(service.snapshot!.map).not.toBe(original);
    expect(parseWorldMaps(disk).collection.maps.length).toBe(2);
    await component.undo();
    expect(component.activeMapName).toBe('World map');
    expect(service.snapshot!.maps!.length).toBe(1);
  });

  it('remembers each map camera and filters and clears road interactions on switching', async () => {
    component.view = { tx: 100, ty: 200, k: 0.8 };
    component.searchTerm = 'A';
    component.filtersChanged();
    await service.createMap('City');
    const cityId = component.activeMapId;
    expect(component.searchTerm).toBe('');
    await fixture.whenStable();
    component.view = { tx: 300, ty: 400, k: 2 };
    component.searchTerm = 'B';
    component.filtersChanged();
    component.roadMode = true;
    component.roadFrom = 'b';
    await component.switchMap('world');
    expect(component.view).toEqual({ tx: 100, ty: 200, k: 0.8 });
    expect(component.searchTerm).toBe('A');
    expect(component.roadMode).toBeFalse();
    expect(component.roadFrom).toBeNull();
    await component.switchMap(cityId);
    expect(component.view).toEqual({ tx: 300, ty: 400, k: 2 });
    expect(component.searchTerm).toBe('B');
  });

  it('saves a deliberate location selection with preserved positions and undoable road removal', async () => {
    component.openMembership();
    component.setMember('a', false);
    component.setMember('c', true);
    await component.saveMembership();
    expect(component.membershipOpen).toBeFalse();
    expect(service.snapshot!.map.pins.map(pin => pin.locationId)).toEqual(['b']);
    expect(component.mapLocations.map(location => location.id)).toEqual(['b', 'c']);
    expect(service.snapshot!.map.pins[0]).toEqual({ locationId: 'b', x: 100, y: 0 });
    expect(service.snapshot!.map.roads).toEqual([]);
    expect(component.locations.length).toBe(3);
    await component.undo();
    expect(service.snapshot!.map.pins.map(pin => pin.locationId)).toEqual(['a', 'b']);
    expect(service.snapshot!.map.roads.length).toBe(1);
  });

  it('previews automatic types with icon rows without changing the map until Apply', async () => {
    component.locations = [loc('a', 'Kingdom', 'country'), loc('b', 'Capital', 'settlement'), loc('c', 'Palace', 'building')];
    component.openMembership();
    component.toggleMembershipType('building');
    expect(component.membershipDraft).toEqual(new Set(['a', 'b', 'c']));
    component.setMember('a', false);
    expect(component.membershipDraft).toEqual(new Set(['b', 'c']));
    expect(service.snapshot!.map.pins.map(pin => pin.locationId)).toEqual(['a', 'b']);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const icons: NodeListOf<SVGUseElement> = fixture.nativeElement.querySelectorAll('.membership-location .location-type-icon use');
    expect(icons.length).toBe(3);
    expect(Array.from(icons).map(icon => icon.getAttribute('href'))).toContain('assets/ui-icons.svg#building');
    component.membershipOpen = false;
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('creates an automatic-type map directly from the creation form, with optional individual membership', async () => {
    component.locations[0].type = 'country';
    component.locations[1].type = 'settlement';
    component.openMapForm('create');
    component.mapNameDraft = 'Continental';
    component.toggleNewMapType('country');
    expect(component.newMapMatchCount).toBe(1);
    await component.saveMapName();
    expect(service.snapshot!.map.membership).toEqual({ types: ['country'], include: [], exclude: [] });
    expect(component.mapLocations.map(location => location.id)).toEqual(['a']);
    expect(service.snapshot!.map.pins).toEqual([]);
    const saved = parseWorldMaps(disk).collection.maps[1].map;
    expect(saved.membership!.types).toEqual(['country']);
    component.openMembership();
    component.setMember('b', true);
    await component.saveMembership();
    expect(component.mapLocations.map(location => location.id)).toEqual(['a', 'b']);
    expect(service.snapshot!.map.pins).toEqual([]);
  });

  it('retains the selection editor and reports a failed save', async () => {
    component.openMembership();
    component.setMember('a', false);
    electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Disk full' });
    await component.saveMembership();
    expect(component.membershipOpen).toBeTrue();
    expect(component.membershipError).toContain('Disk full');
    expect(service.snapshot!.map.pins.map(pin => pin.locationId)).toEqual(['a', 'b']);
  });

  for (const key of ['Delete', 'Backspace']) {
    it(`${key} on a pin writes once and one Undo restores the pin and its roads`, async () => {
      const original: WorldMap = {
        pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }, { locationId: 'c', x: 200, y: 0 }],
        roads: [{ from: 'a', to: 'b', label: 'Coast road' }, { from: 'b', to: 'c' }], notes: 'Keep notes',
      };
      disk = serializeWorldMap(original);
      await service.load(true);
      fixture.detectChanges();
      component.selectRoad(component.roads[0]);
      const pin: SVGElement = fixture.nativeElement.querySelector('.pin[data-location-id="c"]');
      pin.focus();
      pin.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await fixture.whenStable();

      expect(electron.writeFileAtomic).toHaveBeenCalledTimes(1);
      expect(parseWorldMap(disk).map).toEqual({
        ...original, pins: original.pins.slice(0, 2), roads: original.roads.slice(0, 1),
      });
      await component.undo();
      expect(parseWorldMap(disk).map).toEqual(original);
      expect(service.snapshot?.canUndo).toBeFalse();
      expect(service.snapshot?.canRedo).toBeTrue();
    });
  }

  it('writes a background-dismissed label, reopens it, and undoes it in one step', async () => {
    component.selectRoad(component.roads[0]);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.field input');
    input.value = 'Cliff path, 2 days';
    input.dispatchEvent(new Event('input'));
    component.onCanvasPointerDown({ button: 0, pointerId: 1 } as PointerEvent);
    input.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(electron.writeFileAtomic).toHaveBeenCalledOnceWith('/vault/world-map.md', jasmine.any(String));
    expect(parseWorldMap(disk).map.roads[0].label).toBe('Cliff path, 2 days');
    expect(fixture.nativeElement.querySelector('.road-label').textContent).toBe('Cliff path, 2 days');
    component.selectRoad(component.roads[0]);
    expect(component.roadLabelDraft).toBe('Cliff path, 2 days');
    await component.undo();
    expect(parseWorldMap(disk).map.roads[0].label).toBe('Old label');
    expect(service.snapshot?.canUndo).toBeFalse();
    await service.load(true);
    expect(component.roads[0].label).toBe('Old label');
  });
});


describe('Locations map navigation guard', () => {
  it('keeps the canvas and background image mounted when selecting and deselecting areas', async () => {
    const backgroundImage = jasmine.createSpy('backgroundImage').and.resolveTo('data:image/svg+xml,<svg/>');
    const load = jasmine.createSpy('load').and.resolveTo();
    const map = { ...emptyWorldMap(), background: {
      file: 'assets/maps/coast.svg', name: 'Coast', x: 0, y: 0, width: 1000, height: 500, opacity: 1, visible: true,
    } };
    const state$ = new BehaviorSubject<WorldMapState>({ map, readOnly: false, error: null, canUndo: false, canRedo: false });
    TestBed.configureTestingModule({
      providers: [
        provideRouter(['locations', 'location/:id', 'location', 'world-map'].map(path => ({
          path, component: WorldMapComponent, data: { mapCanvas: true }, canDeactivate: [locationEditorGuard],
        }))),
        { provide: RouteReuseStrategy, useClass: MapRouteReuseStrategy },
        { provide: WorldMapService, useValue: { state$, load, backgroundImage } },
        { provide: LocationService, useValue: { getLocations: () => new BehaviorSubject([]), loadLocations: async () => {} } },
        { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/no-flash-test' }) } },
        { provide: NotificationService, useValue: { showError: () => {} } },
        { provide: LoggingService, useValue: { error: () => {} } },
      ],
    });
    TestBed.overrideComponent(WorldMapComponent, { set: {
      template: '<svg #canvas>@if (backgroundVisible) { <image [attr.href]="backgroundUrl" /> }</svg>', imports: [],
    } });
    const harness = await RouterTestingHarness.create();
    const mapComponent = await harness.navigateByUrl('/locations', WorldMapComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();
    const canvas = harness.routeNativeElement!.querySelector('svg');
    const image = canvas!.querySelector('image');
    expect(image).not.toBeNull();
    for (const url of ['/location/region', '/locations', '/location', '/world-map']) {
      const current = await harness.navigateByUrl(url, WorldMapComponent);
      harness.detectChanges();
      expect(current).toBe(mapComponent);
      expect(harness.routeNativeElement!.querySelector('svg')).toBe(canvas);
      expect(canvas!.querySelector('image')).toBe(image);
      expect(current.drawerOpen).toBe(url.startsWith('/location/') || url === '/location');
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(backgroundImage).toHaveBeenCalledTimes(1);
  });

  it('protects unsaved sidebar edits when selecting another location and when closing', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'location/:id', component: WorldMapComponent, canDeactivate: [locationEditorGuard], data: { mapCanvas: true } },
          { path: 'locations', component: WorldMapComponent, canDeactivate: [locationEditorGuard], data: { mapCanvas: true } },
        ]),
        { provide: WorldMapService, useValue: { state$: new BehaviorSubject(null), load: async () => {} } },
        { provide: LocationService, useValue: { getLocations: () => new BehaviorSubject([]), loadLocations: async () => {} } },
        { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/guard-test' }) } },
        { provide: NotificationService, useValue: { showError: () => {} } },
        { provide: LoggingService, useValue: { error: () => {} } },
      ],
    });
    TestBed.overrideComponent(WorldMapComponent, { set: { template: '', imports: [] } });
    TestBed.configureTestingModule({ providers: [{ provide: RouteReuseStrategy, useClass: MapRouteReuseStrategy }] });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/location/a', WorldMapComponent);
    const leave = jasmine.createSpy('canLeave').and.resolveTo(false);
    component.details = { canLeave: leave } as any;
    await component.openLocation(loc('b', 'Castle'));
    expect(TestBed.inject(Router).url).toBe('/location/a');
    expect(leave).toHaveBeenCalledTimes(1);
    leave.calls.reset();
    leave.and.resolveTo(true);
    await component.openLocation(loc('b', 'Castle'));
    expect(TestBed.inject(Router).url).toBe('/location/b?map=world');
    expect(leave).toHaveBeenCalledTimes(1);
    leave.and.resolveTo(false);
    await TestBed.inject(Router).navigateByUrl('/locations');
    expect(TestBed.inject(Router).url).toBe('/location/b?map=world');
    leave.and.resolveTo(true);
    const closed = await harness.navigateByUrl('/locations', WorldMapComponent);
    expect(closed).toBe(component);
    expect(closed.drawerOpen).toBeFalse();
    const selected = await harness.navigateByUrl('/location/a', WorldMapComponent);
    expect(selected).toBe(component);
    expect(selected.drawerOpen).toBeTrue();
  });
});


describe('Map navigation history', () => {
  it('restores maps and location details with Back and Forward, without adding history during restoration', async () => {
    const maps = ['world', 'city', 'district'].map(id => ({ id, name: id, map: emptyWorldMap() }));
    const state$ = new BehaviorSubject<WorldMapState>({
      map: maps[0].map, maps, activeMapId: 'world', readOnly: true, error: null, canUndo: false, canRedo: false,
    });
    const selectMap = jasmine.createSpy('selectMap').and.callFake((id: string) => {
      const entry = maps.find(map => map.id === id);
      if (!entry) return false;
      state$.next({ ...state$.value, map: entry.map, activeMapId: id });
      return true;
    });
    TestBed.configureTestingModule({ providers: [
      provideRouter(['locations', 'location/:id'].map(path => ({
        path, component: WorldMapComponent, data: { mapCanvas: true },
        canDeactivate: [locationEditorGuard], runGuardsAndResolvers: 'paramsOrQueryParamsChange' as const,
      }))),
      provideLocationMocks(),
      { provide: RouteReuseStrategy, useClass: MapRouteReuseStrategy },
      { provide: WorldMapService, useValue: { state$, selectMap, load: async () => {} } },
      { provide: LocationService, useValue: { getLocations: () => new BehaviorSubject([]), loadLocations: async () => {} } },
      { provide: ProjectService, useValue: { getCurrentProject: () => ({ path: '/map-history-test' }) } },
      { provide: NotificationService, useValue: { showError: () => {} } },
      { provide: LoggingService, useValue: { error: () => {} } },
    ] });
    TestBed.overrideComponent(WorldMapComponent, { set: { template: '<svg #canvas></svg>', imports: [] } });
    TestBed.inject(Router).setUpLocationChangeListener();
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/locations', WorldMapComponent);
    await harness.fixture.whenStable();
    const router = TestBed.inject(Router);
    const history = TestBed.inject(BrowserLocation);
    expect(router.url).toBe('/locations?map=world');
    await component.openLocation(loc('harbor', 'Harbor'));
    expect(router.url).toBe('/location/harbor?map=world');
    await component.openDestinationMap('city');
    expect(router.url).toBe('/locations?map=city');
    expect(component.activeMapId).toBe('city');
    await component.switchMap('district');
    expect(router.url).toBe('/locations?map=district');
    expect(component.activeMapId).toBe('district');
    const move = async (direction: 'back' | 'forward') => {
      const finished = firstValueFrom(router.events.pipe(filter(event => event instanceof NavigationEnd)));
      history[direction]();
      await finished;
      await harness.fixture.whenStable();
    };
    await move('back');
    expect(router.url).toBe('/locations?map=city');
    expect(component.activeMapId).toBe('city');
    expect(component.drawerOpen).toBeFalse();
    await move('back');
    expect(router.url).toBe('/location/harbor?map=world');
    expect(component.activeMapId).toBe('world');
    expect(component.drawerOpen).toBeTrue();
    await move('back');
    expect(router.url).toBe('/locations?map=world');
    await move('forward');
    expect(router.url).toBe('/location/harbor?map=world');
    await move('forward');
    expect(component.activeMapId).toBe('city');
    await move('forward');
    expect(component.activeMapId).toBe('district');
    expect(harness.routeDebugElement!.componentInstance).toBe(component);
  });
});
