import { CharacterListComponent } from './character-list.component';

describe('Character collection filters', () => {
  let component: any;
  const prefix = 'characterCollectionFilters:/test/lore-filters:';

  beforeEach(() => {
    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      currentProject: { path: '/test/lore-filters' }, collection: 'characters', collectionInitialized: true,
      categories: [{ id: 'people' }], disabledCategoryIds: [], selectedTags: [],
      selectedCast: '', selectedHouse: '', selectedBook: '', selectedPictureFilter: '', povOnly: false,
      searchTerm: 'Hero', groupBy: 'category', sortBy: 'name', sortDirection: 'desc',
      viewMode: 'list', columns: 1, galleryThumbnailSize: 'big',
      recomputePovBadgeState: jasmine.createSpy(),
    });
  });
  afterEach(() => ['characters', 'lore', 'drawer'].forEach(c => localStorage.removeItem(prefix + c)));

  it('restores each collection independently without carrying filters into Lore or Drawer', () => {
    component.saveCollectionFilters();
    component.collection = 'lore';
    component.restoreCollectionFilters();
    expect(component.searchTerm).toBe('');
    expect(component.groupBy).toBe('none');
    expect(component.selectedTags).toEqual([]);
    component.searchTerm = 'Founder';
    component.selectedTags = ['ancient'];
    component.selectedHouse = 'house-one';
    component.saveCollectionFilters();
    component.collection = 'characters';
    component.restoreCollectionFilters();
    expect(component.searchTerm).toBe('Hero');
    expect(component.viewMode).toBe('list');
    expect(component.columns).toBe(1);
    component.collection = 'drawer';
    component.restoreCollectionFilters();
    expect(component.searchTerm).toBe('');
    component.collection = 'lore';
    component.restoreCollectionFilters();
    expect(component.searchTerm).toBe('Founder');
    expect(component.selectedTags).toEqual(['ancient']);
    expect(component.selectedHouse).toBe('house-one');
  });
});
