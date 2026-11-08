import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { WorldMapComponent } from './world-map.component';
import { Location, getLocationPlaceholderIcon } from '../../core/interfaces/location.interface';
import { LocationService } from '../../core/services/location.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProjectService } from '../../core/services/project.service';
import { WorldMapService, WorldMapState } from '../../core/services/world-map.service';
import { WorldMap, emptyWorldMap } from '../../core/utils/world-map.utils';

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
