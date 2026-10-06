import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { LocationListComponent } from './location-list.component';
import { Location } from '../../core/interfaces/location.interface';
import { MetadataService, LocationService, ProjectService, LoggingService, MetadataHelperService } from '../../core/services';

describe('LocationListComponent filters', () => {
  let component: LocationListComponent;
  let locations: BehaviorSubject<Location[]>;
  const filterKeys = ['locationSelectedType', 'locationSelectedBook', 'locationSelectedPicture', 'locationSearchTerm'];

  beforeEach(() => {
    filterKeys.forEach((key) => localStorage.removeItem(key));
    locations = new BehaviorSubject<Location[]>([
      { id: 'city', name: 'Harbor', type: 'settlement', books: ['book'], thumbnail: 'harbor.png', content: 'Coastal port' },
      { id: 'forest', name: 'Woods', type: 'natural-feature', books: ['book'], content: 'Ancient trees' },
      { id: 'legacy', name: 'Old Place', books: [], content: '' },
    ].map((location) => ({ ...location, created: new Date(), modified: new Date(), relativePath: '', filePath: '' })) as Location[]);
    TestBed.configureTestingModule({
      imports: [LocationListComponent],
      providers: [
        { provide: LocationService, useValue: { getLocations: () => locations, loadThumbnailsForLocations: async () => {}, getCachedThumbnail: () => null } },
        { provide: MetadataService, useValue: { metadata$: of({ books: [{ id: 'book', name: 'Book', color: '#ffffff' }] }) } },
        { provide: ProjectService, useValue: { getCurrentProject: () => null } },
        { provide: Router, useValue: { navigate: jasmine.createSpy() } },
        { provide: LoggingService, useValue: { error: jasmine.createSpy() } },
        { provide: MetadataHelperService, useValue: { getBookName: () => 'Book' } },
      ],
    });
    component = TestBed.createComponent(LocationListComponent).componentInstance;
  });

  afterEach(() => filterKeys.forEach((key) => localStorage.removeItem(key)));

  it('combines type, book, picture and search filters, then clears them', () => {
    component.ngOnInit();
    component.selectedType = 'settlement';
    component.selectedBook = 'book';
    component.selectedPictureFilter = 'with';
    component.searchTerm = 'coastal';
    component.onFilterChange();
    expect(component.filteredLocations.map((location) => location.id)).toEqual(['city']);
    component.selectedPictureFilter = 'without';
    component.onFilterChange();
    expect(component.filteredLocations).toEqual([]);
    component.clearFilters();
    expect(component.filteredLocations.length).toBe(3);
    expect(component.hasActiveFilters).toBeFalse();
    expect(localStorage.getItem('locationSelectedType')).toBeNull();
  });

  it('restores filters and includes older locations under Unspecified', () => {
    localStorage.setItem('locationSelectedType', 'unspecified');
    localStorage.setItem('locationSelectedPicture', 'without');
    component.ngOnInit();
    expect(component.filteredLocations.map((location) => location.id)).toEqual(['legacy']);
    component.selectedType = 'natural-feature';
    component.onFilterChange();
    expect(component.filteredLocations.map((location) => location.id)).toEqual(['forest']);
    expect(localStorage.getItem('locationSelectedType')).toBe('natural-feature');
  });

  it('searches by the visible type label', () => {
    component.ngOnInit();
    component.searchTerm = 'natural feature';
    component.onSearchChange();
    expect(component.filteredLocations.map((location) => location.id)).toEqual(['forest']);
  });
});
