import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HouseDetailComponent } from './house-detail.component';
import { House, HouseFormData } from '../../core/interfaces/house.interface';
import { HouseService } from '../../core/services/house.service';
import { CharacterPickerService, CharacterService, ImagePickerService, LocationService, ProjectService } from '../../core/services';
import { ElectronService } from '../../core/services/electron.service';

function house(): House {
  return {
    id: 'stark', name: 'House Stark', motto: 'Winter is coming', colors: ['#ffffff'], characterIds: ['ned'], content: 'Ancient history',
    leadership: [
      { id: 'old', characterIds: ['founder'], period: 'Ancient era', books: [], notes: '' },
      { id: 'ned-reign', characterIds: ['ned'], period: 'Years 280–298', books: ['book'], notes: '' },
      { id: 'joint', characterIds: ['ned', 'cat'], period: 'Later era', books: ['book'], notes: '' },
    ], currentLeadershipId: 'ned-reign', filePath: '/project/houses/stark/stark.md', relativePath: 'stark/stark.md', raw: 'revision-one', created: new Date(), modified: new Date(),
  };
}

describe('House editor', () => {
  let component: HouseDetailComponent;
  let fixture: ComponentFixture<HouseDetailComponent>;
  let houses$: BehaviorSubject<House[]>;
  let service: jasmine.SpyObj<HouseService>;
  let characterPicker: jasmine.SpyObj<CharacterPickerService>;

  beforeEach(async () => {
    houses$ = new BehaviorSubject([house()]);
    characterPicker = jasmine.createSpyObj('CharacterPickerService', ['pick']);
    characterPicker.pick.and.resolveTo(null);
    service = jasmine.createSpyObj('HouseService', ['loadHouses', 'getById', 'loadCrest', 'updateHouse', 'createHouse', 'deleteHouse'], { houses$: houses$.asObservable() });
    service.loadHouses.and.resolveTo();
    service.getById.and.callFake(id => houses$.value.find(item => item.id === id));
    service.loadCrest.and.resolveTo(null);
    service.updateHouse.and.callFake(async (_id, data: HouseFormData) => ({ ...house(), ...data, raw: 'saved' }));
    await TestBed.configureTestingModule({ imports: [HouseDetailComponent], providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'stark' })), snapshot: { paramMap: convertToParamMap({ id: 'stark' }) } } },
      { provide: HouseService, useValue: service },
      { provide: CharacterPickerService, useValue: characterPicker },
      { provide: CharacterService, useValue: {
        getCharacters: () => of([{ id: 'ned', name: 'Eddard Stark' }, { id: 'cat', name: 'Catelyn Stark' }]),
        loadCharacters: async () => undefined, loadThumbnailsForCharacters: async () => undefined, getCachedThumbnail: () => null,
      } },
      { provide: LocationService, useValue: { getLocations: () => of([{ id: 'winterfell', name: 'Winterfell' }]), loadLocations: async () => undefined } },
      { provide: ProjectService, useValue: { currentProject$: of({ metadata: { books: [{ id: 'book', name: 'First Book', color: '#ffffff' }] } }), getCurrentProject: () => ({ path: '/project' }) } },
      { provide: ImagePickerService, useValue: { state$: of({ isOpen: false }), close: () => undefined, handleNavigationAway: () => true } },
      { provide: ElectronService, useValue: { onBrowserNavigationCommand: () => undefined, removeBrowserNavigationCommandListener: () => undefined } },
    ] }).compileComponents();
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(HouseDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders historical reigns and preserves missing character references', async () => {
    expect(component.loading).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Ancient era');
    expect(fixture.nativeElement.querySelector('.succession select')).toBeNull();
    expect(fixture.nativeElement.querySelector('.succession textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('.drag-handle')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Missing character (founder)');
    expect(fixture.nativeElement.querySelectorAll('.leadership-row').length).toBe(3);
    fixture.nativeElement.querySelector('.succession .leadership-mode button:last-child').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#current-reign')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#period-old').value).toBe('Ancient era');
    expect(component.dirty).toBeFalse();
    expect(component.model.leadership[0].characterIds).toEqual(['founder']);
  });

  it('filters book references without reordering or permitting filtered drag/move operations', () => {
    component.leadershipEditing = true;
    component.selectedBook = 'book';
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(component.visibleLeadership.map(entry => entry.id)).toEqual(['ned-reign', 'joint']);
    expect(fixture.nativeElement.querySelectorAll('.reign').length).toBe(2);
    component.moveReign(1, -1);
    component.drop({ previousIndex: 1, currentIndex: 0 } as any);
    expect(component.model.leadership.map(entry => entry.id)).toEqual(['old', 'ned-reign', 'joint']);
    component.selectedBook = '';
    expect(component.visibleLeadership[0].id).toBe('old');
  });

  it('saves manual succession order independently of the selected current reign', async () => {
    component.moveReign(2, -1);
    await component.save();
    const [, data, revision] = service.updateHouse.calls.mostRecent().args;
    expect(data.leadership.map(entry => entry.id)).toEqual(['old', 'joint', 'ned-reign']);
    expect(data.currentLeadershipId).toBe('ned-reign');
    expect(revision).toBe('revision-one');
    expect(component.dirty).toBeFalse();
  });

  it('keeps unsaved edits and blocks saving when an external revision arrives', async () => {
    component.model.motto = 'My unsaved motto';
    component.changed();
    houses$.next([{ ...house(), motto: 'External motto', raw: 'external-revision' }]);
    expect(component.conflict).toBeTrue();
    expect(component.model.motto).toBe('My unsaved motto');
    await component.save();
    expect(service.updateHouse).not.toHaveBeenCalled();
  });

  it('refreshes a clean editor after an external revision', () => {
    houses$.next([{ ...house(), motto: 'External motto', raw: 'external-revision' }]);
    expect(component.model.motto).toBe('External motto');
    expect(component.conflict).toBeFalse();
  });

  it('clears the current-head marker when its reign is removed', () => {
    component.removeReign('ned-reign');
    expect(component.model.currentLeadershipId).toBeUndefined();
    expect(component.model.leadership.map(entry => entry.id)).toEqual(['old', 'joint']);
  });
  it('shows assigned members and uses the existing popup to add another character', async () => {
    const members = fixture.nativeElement.querySelector('.members-panel');
    expect(members.textContent).toContain('Eddard Stark');
    expect(members.textContent).not.toContain('Catelyn Stark');
    expect(members.querySelector('input')).toBeNull();
    characterPicker.pick.and.resolveTo({ id: 'cat', name: 'Catelyn Stark' } as any);
    members.querySelector('.section-heading button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(characterPicker.pick).toHaveBeenCalledTimes(1);
    expect(component.model.characterIds).toEqual(['ned', 'cat']);
    expect(members.textContent).toContain('Catelyn Stark');
    expect(component.dirty).toBeTrue();
    await component.addMember();
    expect(component.model.characterIds).toEqual(['ned', 'cat']);
  });

  it('keeps cancellation clean and blocks saving until the member picker closes', async () => {
    let finishPick!: (character: null) => void;
    characterPicker.pick.and.returnValue(new Promise(resolve => { finishPick = resolve; }));
    const pending = component.addMember();
    await component.save();
    expect(service.updateHouse).not.toHaveBeenCalled();
    expect(component.pickingMember).toBeTrue();
    finishPick(null);
    await pending;
    expect(component.model.characterIds).toEqual(['ned']);
    expect(component.dirty).toBeFalse();
    expect(component.pickingMember).toBeFalse();
  });

  it('allows its own route guard to navigate after a new House is saved', async () => {
    component.house = null;
    component.changed();
    service.createHouse.and.resolveTo(house());
    const navigate = TestBed.inject(Router).navigate as jasmine.Spy;
    navigate.and.callFake(async () => {
      expect(component.canLeave()).toBeTrue();
      return true;
    });
    await component.save();
    expect(navigate).toHaveBeenCalledWith(['/house', 'stark'], { replaceUrl: true });
  });

  it('allows its own route guard to navigate after a House is deleted', async () => {
    service.deleteHouse.and.resolveTo();
    const navigate = TestBed.inject(Router).navigate as jasmine.Spy;
    navigate.and.callFake(async () => {
      expect(component.canLeave()).toBeTrue();
      return true;
    });
    await component.delete();
    expect(navigate).toHaveBeenCalledWith(['/houses']);
  });

});
