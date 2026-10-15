import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { provideRouter } from '@angular/router';
import { CharacterHousesComponent } from './character-houses.component';
import { HouseService } from '../../core/services/house.service';

describe('Character House memberships', () => {
  let fixture: ComponentFixture<CharacterHousesComponent>;
  let houses$: BehaviorSubject<any[]>;
  let service: jasmine.SpyObj<HouseService>;
  beforeEach(() => {
    houses$ = new BehaviorSubject([{ id: 'one', name: 'House One', characterIds: ['ned'] }, { id: 'two', name: 'House Two', characterIds: [] }]);
    service = jasmine.createSpyObj('HouseService', ['loadHouses', 'loadCrest'], { houses$: houses$.asObservable() });
    service.loadHouses.and.resolveTo();
    service.loadCrest.and.resolveTo(null);
    TestBed.configureTestingModule({ imports: [CharacterHousesComponent], providers: [provideRouter([]), { provide: HouseService, useValue: service }] });
    fixture = TestBed.createComponent(CharacterHousesComponent);
  });

  it('shows only assigned Houses as links without membership controls', () => {
    fixture.componentRef.setInput('characterId', 'ned');
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('House One');
    expect(element.textContent).not.toContain('House Two');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/house/one');
    expect(element.querySelector('input')).toBeNull();
  });

  it('hides the appendix for unassigned and new characters', () => {
    fixture.componentRef.setInput('characterId', 'arya');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    fixture.componentRef.setInput('characterId', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('places the saved image and name inside the same House link', async () => {
    service.loadCrest.and.resolveTo('data:image/png;base64,crest');
    fixture.componentRef.setInput('characterId', 'ned');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a');
    expect(link.getAttribute('href')).toBe('/house/one');
    expect(link.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,crest');
    expect(link.querySelector('.house-name')?.textContent).toContain('House One');
    expect(service.loadCrest).toHaveBeenCalledTimes(1);
  });

  it('keeps a shield and the House link when the image cannot be loaded', async () => {
    service.loadCrest.and.rejectWith(new Error('Missing image'));
    fixture.componentRef.setInput('characterId', 'ned');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a');
    expect(link.querySelector('.house-image svg')).not.toBeNull();
    expect(link.querySelector('img')).toBeNull();
    expect(link.getAttribute('href')).toBe('/house/one');
  });

  it('updates visible Houses when memberships change or another character opens', () => {
    fixture.componentRef.setInput('characterId', 'ned');
    fixture.detectChanges();
    houses$.next([{ id: 'two', name: 'House Two', characterIds: ['arya'] }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    fixture.componentRef.setInput('characterId', 'arya');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('House Two');
  });
});
