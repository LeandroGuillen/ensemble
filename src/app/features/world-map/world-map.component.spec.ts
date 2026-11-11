import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { ElectronService } from '../../core/services/electron.service';
import { FileWatcherService } from '../../core/services/file-watcher.service';
import { WorldMapComponent } from './world-map.component';
import { Location, getLocationPlaceholderIcon } from '../../core/interfaces/location.interface';
import { LocationService } from '../../core/services/location.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProjectService } from '../../core/services/project.service';
import { WorldMapService, WorldMapState } from '../../core/services/world-map.service';
import { WorldMap, emptyWorldMap, parseWorldMap, serializeWorldMap } from '../../core/utils/world-map.utils';

function loc(id: string, name: string, type?: Location['type']): Location {
  return { id, name, type, books: [], content: '', created: new Date(), modified: new Date(), relativePath: '', filePath: '' };
}

describe('WorldMapComponent', () => {
  let fixture: ComponentFixture<WorldMapComponent>;
  let component: WorldMapComponent;
  let locations$: BehaviorSubject<Location[]>;
  let state$: BehaviorSubject<WorldMapState | null>;
  let worldMap: jasmine.SpyObj<WorldMapService> & { snapshot: WorldMapState | null };
  let router: { navigate: jasmine.Spy };

  const setState = (map: WorldMap, extra: Partial<WorldMapState> = {}) =>
    state$.next({ map, readOnly: false, error: null, canUndo: false, canRedo: false, ...extra });

  beforeEach(() => {
    locations$ = new BehaviorSubject<Location[]>([]);
    state$ = new BehaviorSubject<WorldMapState | null>(null);
    worldMap = jasmine.createSpyObj('WorldMapService', ['load', 'apply', 'undo', 'redo']) as any;
    Object.defineProperty(worldMap, 'state$', { value: state$.asObservable() });
    Object.defineProperty(worldMap, 'snapshot', { get: () => state$.value });
    worldMap.load.and.resolveTo();
    worldMap.apply.and.callFake(async (next: WorldMap) => {
      setState(next, { canUndo: true });
      return true;
    });
    router = { navigate: jasmine.createSpy('navigate') };

    TestBed.configureTestingModule({
      imports: [WorldMapComponent],
      providers: [
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

  it('shows a clear empty state with 0 locations and no crash', async () => {
    setState(emptyWorldMap());
    await render();
    expect(query('[data-testid="empty-no-locations"]')).not.toBeNull();
    expect(query('.pin')).toBeNull();
  });

  it('lists unplaced locations and offers to pin them all when nothing is on the map', async () => {
    locations$.next([loc('a', 'Grey Harbor', 'settlement'), loc('b', 'Aldmere', 'country')]);
    setState(emptyWorldMap());
    await render();
    expect(query('[data-testid="empty-no-pins"]')).not.toBeNull();
    expect(component.unplaced.map((l) => l.name)).toEqual(['Aldmere', 'Grey Harbor']);

    await component.pinAllUnplaced();
    const saved = worldMap.apply.calls.mostRecent().args[0] as WorldMap;
    // Ordered by type (country before settlement), then laid out without overlaps.
    expect(saved.pins.map((p) => p.locationId)).toEqual(['b', 'a']);
    expect(new Set(saved.pins.map((p) => `${p.x},${p.y}`)).size).toBe(2);
    await render();
    expect(component.unplaced).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.pin').length).toBe(2);
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
    expect(router.navigate).toHaveBeenCalledWith(['/location', 'a']);
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
    await component.pinAllUnplaced();
    await component.pinAtCenter(component.unplaced[0]);
    expect(worldMap.apply).not.toHaveBeenCalled();
  });
});

// Exercise the component with the real persistence and history service, using an
// in-memory IPC filesystem so no project files are touched.
describe('WorldMapComponent road label persistence', () => {
  it('writes a background-dismissed label, reopens it, and undoes it in one step', async () => {
    const locations = [loc('a', 'A'), loc('b', 'B')];
    let disk = serializeWorldMap({
      pins: [{ locationId: 'a', x: 0, y: 0 }, { locationId: 'b', x: 100, y: 0 }],
      roads: [{ from: 'a', to: 'b', label: 'Old label' }], notes: '',
    });
    const electron = jasmine.createSpyObj('ElectronService', ['fileExists', 'readFile', 'writeFileAtomic', 'isWritable']);
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
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showError']) },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error']) },
      ],
    });
    const service = TestBed.inject(WorldMapService);
    await service.load();
    const fixture = TestBed.createComponent(WorldMapComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
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
