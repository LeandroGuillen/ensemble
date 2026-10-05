import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { provideRouter } from '@angular/router';
import { CharacterHousesComponent } from './character-houses.component';
import { HouseService } from '../../core/services/house.service';

describe('Character House memberships', () => {
  let component: CharacterHousesComponent;
  let service: jasmine.SpyObj<HouseService>;
  let houses$: BehaviorSubject<any[]>;
  beforeEach(() => {
    houses$ = new BehaviorSubject([{ id: 'one', name: 'House One', characterIds: ['ned'] }, { id: 'two', name: 'House Two', characterIds: [] }]);
    service = jasmine.createSpyObj('HouseService', ['loadHouses', 'setMembership'], { houses$: houses$.asObservable() });
    service.loadHouses.and.resolveTo();
    service.setMembership.and.resolveTo();
    TestBed.configureTestingModule({ imports: [CharacterHousesComponent], providers: [provideRouter([]), { provide: HouseService, useValue: service }] });
    component = TestBed.createComponent(CharacterHousesComponent).componentInstance;
    component.characterId = 'ned';
    component.ngOnInit();
  });

  it('keeps pending selections when Houses reload and saves only changed memberships', async () => {
    component.toggle('two');
    houses$.next([...houses$.value]);
    expect(component.selected).toEqual(['one', 'two']);
    await component.save('ned');
    expect(service.setMembership).toHaveBeenCalledOnceWith('two', 'ned', true);
  });

  it('retries only unfinished membership writes after a partial failure', async () => {
    component.toggle('one');
    component.toggle('two');
    service.setMembership.and.callFake(async id => { if (id === 'two') throw new Error('Disk failure'); });
    await expectAsync(component.save('ned')).toBeRejectedWithError('Disk failure');
    service.setMembership.calls.reset();
    service.setMembership.and.resolveTo();
    await component.save('ned');
    expect(service.setMembership).toHaveBeenCalledOnceWith('two', 'ned', true);
  });
});
