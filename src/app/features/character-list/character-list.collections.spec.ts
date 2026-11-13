import { PreferencesService } from '../../core/services/preferences.service';
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
    expect(component.groupBy).toBe('category');
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

  it('keeps all view settings shared even when old collection snapshots contain view settings', () => {
    localStorage.setItem(prefix + 'lore', JSON.stringify({
      searchTerm: 'Founder', groupBy: 'none', sortBy: 'category', sortDirection: 'asc',
      viewMode: 'grid', columns: 2, galleryThumbnailSize: 'small',
    }));
    component.collection = 'lore';
    component.restoreCollectionFilters();
    expect(component.searchTerm).toBe('Founder');
    expect(component.groupBy).toBe('category');
    expect(component.sortBy).toBe('name');
    expect(component.sortDirection).toBe('desc');
    expect(component.viewMode).toBe('list');
    expect(component.columns).toBe(1);
    expect(component.galleryThumbnailSize).toBe('big');
    component.saveCollectionFilters();
    const saved = JSON.parse(localStorage.getItem(prefix + 'lore')!);
    for (const key of ['groupBy', 'sortBy', 'sortDirection', 'viewMode', 'columns', 'galleryThumbnailSize']) {
      expect(saved[key]).toBeUndefined();
    }
  });

  it('persists shared view changes independently of collection filters across sessions', () => {
    const keys = ['characterGroupBy', 'characterSortBy', 'characterSortDirection', 'characterViewMode', 'characterColumns', 'galleryThumbnailSize'];
    const previous = keys.map(key => localStorage.getItem(key));
    try {
      component.preferences = new PreferencesService();
      component.applyFilters = jasmine.createSpy();
      component.updateCategoryDropListIds = jasmine.createSpy();
      component.setGroupBy('tag');
      component.setSortBy('category');
      component.setSortBy('category');
      component.setViewMode('gallery');
      component.setColumns(2);
      component.setGalleryThumbnailSize('small');
      component.collection = 'drawer';
      component.restoreCollectionFilters();
      expect(component.groupBy).toBe('tag');
      expect(component.sortBy).toBe('category');
      expect(component.sortDirection).toBe('desc');
      expect(component.viewMode).toBe('gallery');
      expect(component.galleryThumbnailSize).toBe('small');
      const nextSession = new PreferencesService();
      expect(nextSession.getGroupBy()).toBe('tag');
      expect(nextSession.getSortBy()).toBe('category');
      expect(nextSession.getSortDirection()).toBe('desc');
      expect(nextSession.getViewMode()).toBe('gallery');
      expect(nextSession.getColumns()).toBe(2);
      expect(nextSession.getGalleryThumbnailSize()).toBe('small');
    } finally {
      keys.forEach((key, index) => previous[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous[index]!));
    }
  });

});
