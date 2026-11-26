import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Character } from '../../core/interfaces';
import { MetadataHelperService } from '../../core/services/metadata-helper.service';
import { PromptService } from '../../core/services/prompt.service';
import { CharacterListComponent } from './character-list.component';
import { CharacterCompactViewComponent } from './views/character-compact-view/character-compact-view.component';
import { CharacterGridViewComponent } from './views/character-grid-view/character-grid-view.component';
import { CharacterListViewComponent } from './views/character-list-view/character-list-view.component';

describe('Characters with book-specific tags', () => {
  const tags = [
    { id: 'noble', name: 'Noble', color: '#eeeeee' },
    { id: 'tide', name: 'Tide Touched', color: '#008888' },
    { id: 'oath', name: 'Oathbound', color: '#884400' },
    { id: 'main-only', name: 'Main Only', color: '#777777' },
  ];
  const books = [
    { id: 'tidebreak', name: 'Tidebreak' },
    { id: 'lantern', name: 'The Lantern Keepers' },
  ];
  const defaults = {
    category: '', prompts: [], content: '', relativePath: '', filePath: '',
    created: new Date(0), modified: new Date(0),
  };
  const ilse: Character = {
    ...defaults,
    id: 'ilse', name: 'Ilse Dunmore', tags: ['noble', 'main-only'],
    books: ['tidebreak', 'lantern'], bookTags: { tidebreak: ['tide', 'noble'], lantern: ['oath'] },
  };
  const saffi: Character = {
    ...defaults,
    id: 'saffi', name: 'Saffi Reed', tags: ['tide'], books: ['tidebreak'],
  };
  const cael: Character = {
    ...defaults,
    id: 'cael', name: 'Brother Cael', tags: ['oath'], books: ['lantern'],
  };
  const bookTagsOnly: Character = {
    ...defaults,
    id: 'book-only', name: 'Book Tags Only', tags: [], books: ['tidebreak'],
    bookTags: { tidebreak: ['noble'] },
  };
  const metadataHelper = {
    getCategoryName: () => '',
    getCategoryColor: () => '#eeeeee',
    getBookName: (id: string) => books.find(book => book.id === id)!.name,
    getTagName: (id: string) => tags.find(tag => tag.id === id)!.name,
  };

  let component: CharacterListComponent;

  beforeEach(() => {
    component = Object.assign(Object.create(CharacterListComponent.prototype), {
      collection: 'characters',
      allCharacters: [saffi, cael, ilse, bookTagsOnly],
      categories: [],
      enabledCategoryIds: [],
      selectedBook: '',
      selectedTags: [],
      books,
      tags,
      metadataHelper,
      recomputePovBadgeState: () => undefined,
      syncCacheFromService: () => undefined,
      loadThumbnailDataUrls: async () => undefined,
      saveCollectionFilters: () => undefined,
      recomputeGroups: () => undefined,
      updateCategoryDropListIds: () => undefined,
    });
  });

  it('matches tags from each selected book, falling back to main tags for characters without overrides', () => {
    component.selectedBook = 'tidebreak';
    component.selectedTags = ['tide'];
    expect(component['filterCharacters'](component.allCharacters)).toEqual([saffi, ilse]);

    component.selectedBook = 'lantern';
    component.selectedTags = ['oath'];
    expect(component['filterCharacters'](component.allCharacters)).toEqual([cael, ilse]);
  });

  it('excludes a dropped main tag until the Book filter is cleared', () => {
    component.selectedBook = 'tidebreak';
    component.selectedTags = ['main-only'];
    expect(component['filterCharacters'](component.allCharacters)).toEqual([]);

    component.selectedBook = '';
    expect(component['filterCharacters'](component.allCharacters)).toEqual([ilse]);
  });

  it('searches tag names in the selected book context', () => {
    component.selectedBook = 'tidebreak';
    component.searchTerm = 'tide touched';
    expect(component['filterCharacters'](component.allCharacters)).toEqual([saffi, ilse]);

    component.searchTerm = 'main only';
    expect(component['filterCharacters'](component.allCharacters)).toEqual([]);
  });

  it('groups characters by the tags shown under the Book filter', () => {
    component.selectedBook = 'tidebreak';
    component.filteredCharacters = [ilse, bookTagsOnly];
    expect(component['computeGroupedByTag']()).toEqual([
      { tagId: 'noble', characters: [ilse, bookTagsOnly] },
      { tagId: 'tide', characters: [ilse] },
    ]);
  });

  it('applies the same tag matching from a saved Book and Tags preset', () => {
    component.currentProject = {
      metadata: {
        characterFilterPresets: [{
          id: 'tide-preset', name: 'Tidebreak characters',
          filters: { selectedBook: 'tidebreak', selectedTags: ['tide'] },
        }],
      },
    } as CharacterListComponent['currentProject'];
    component.selectPreset('tide-preset');
    component.applyPreset();
    expect(component.filteredCharacters).toEqual([saffi, ilse]);
  });

  const views = [
    { name: 'grid', view: CharacterGridViewComponent, chipSelector: '.character-tags .tag-chip' },
    { name: 'list', view: CharacterListViewComponent, chipSelector: '.list-item-tags .tag' },
    { name: 'compact', view: CharacterCompactViewComponent, chipSelector: '.compact-item-tags .tag' },
  ];
  for (const { name, view, chipSelector } of views) {
    it(`renders book tags in the ${name} view, including when main tags are empty`, fakeAsync(() => {
      TestBed.configureTestingModule({
        imports: [view],
        providers: [
          provideRouter([]),
          { provide: MetadataHelperService, useValue: metadataHelper },
          { provide: PromptService, useValue: { prompts$: of([]) } },
        ],
      });
      const fixture = TestBed.createComponent<unknown>(view);
      fixture.componentRef.setInput('characters', [ilse, bookTagsOnly]);
      fixture.componentRef.setInput('tags', tags);
      const root: HTMLElement = fixture.nativeElement;
      const chips = (character: Character) => Array.from(
        root.querySelectorAll(`[data-character-id="${character.id}"] ${chipSelector}`),
        chip => chip.textContent?.trim(),
      );

      fixture.componentRef.setInput('categoryContextBookId', 'tidebreak');
      fixture.detectChanges();
      tick(16);
      expect(chips(ilse)).toEqual(['Noble', 'Tide Touched']);
      expect(chips(bookTagsOnly)).toEqual(['Noble']);

      fixture.componentRef.setInput('categoryContextBookId', '');
      fixture.detectChanges();
      expect(chips(ilse)).toEqual(['Noble', 'Main Only']);
      expect(chips(bookTagsOnly)).toEqual([]);
    }));
  }
});
