import { CharacterListComponent } from './character-list.component';
import { Character } from '../../core/interfaces/character.interface';
import { Project } from '../../core/interfaces/project.interface';

describe('Characters saved filters', () => {
  let component: CharacterListComponent;
  let project: Project;
  const ids = (characters: Character[]) => characters.map(character => character.id);

  beforeEach(() => {
    component = Object.create(CharacterListComponent.prototype);
    project = { path: '/test/presets', metadata: {} } as Project;
    Object.assign(component, {
      currentProject: project,
      collection: 'characters',
      categories: [],
      disabledCategoryIds: [],
      enabledCategoryIds: [],
      tags: [{ id: 'magic', name: 'Magic' }],
      books: [{ id: 'book-2', name: 'Second book', povCharacterIds: ['mara'] }],
      houses: [],
      casts: [],
      allCharacters: [
        { id: 'mara', name: 'Mara', books: ['book-2'], tags: ['magic'] },
        { id: 'orin', name: 'Orin', books: [], tags: [] },
      ],
      searchTerm: '',
      selectedTags: ['magic'],
      selectedCast: '',
      selectedHouse: '',
      selectedBook: 'book-2',
      selectedPictureFilter: '',
      selectedPromptFilter: '',
      povOnly: false,
      promptLinkedIds: new Set(['orin']),
      presetName: 'Book 2 magic',
      cdr: { markForCheck: () => undefined },
      projectService: {
        updateMetadata: async (updates: Partial<Project['metadata']>) => Object.assign(project.metadata, updates),
      },
      pendingEdits: { track: () => undefined },
      modalService: { confirm: async () => true },
      syncCacheFromService: () => undefined,
      loadThumbnailDataUrls: async () => undefined,
      recomputeGroups: () => undefined,
      updateCategoryDropListIds: () => undefined,
      sortCharacters: (characters: Character[]) => characters,
    });
  });

  it('applies either named combination to the controls and results, retaining independent snapshots', async () => {
    await component.savePreset();
    component.selectedTags.push('new-tag');
    component.selectedBook = '';
    component.selectedTags = [];
    component.selectedPromptFilter = 'with';
    component.presetName = 'Has prompts';
    await component.savePreset();
    expect(component.savedFilters.map(preset => preset.name)).toEqual(['Book 2 magic', 'Has prompts']);

    component.selectPreset(component.savedFilters[0].id);
    component.applyPreset();
    expect(component.selectedBook).toBe('book-2');
    expect(component.selectedTags).toEqual(['magic']);
    expect(component.selectedPromptFilter).toBe('');
    expect(ids(component.filteredCharacters)).toEqual(['mara']);

    component.selectedTags.push('another-tag');
    component.selectPreset(component.savedFilters[1].id);
    component.applyPreset();
    expect(component.selectedBook).toBe('');
    expect(component.selectedTags).toEqual([]);
    expect(component.selectedPromptFilter).toBe('with');
    expect(ids(component.filteredCharacters)).toEqual(['orin']);
    expect(component.savedFilters[0].filters.selectedTags).toEqual(['magic']);

    component.presetName = 'Prompt links';
    await component.renamePreset();
    expect(component.savedFilters[1].name).toBe('Prompt links');
    expect(component.savedFilters[1].filters.selectedPromptFilter).toBe('with');
    await component.deletePreset();
    expect(component.savedFilters.map(preset => preset.name)).toEqual(['Book 2 magic']);
  });

  it('reports removed criteria, applies valid ones and keeps the active filters when all are missing', async () => {
    await component.savePreset();
    component.books = [];
    component.selectedBook = 'other-book';
    component.selectedPromptFilter = 'with';
    component.applyPreset();
    expect(component.presetNotice).toContain('Book "Second book"');
    expect(component.selectedBook).toBe('');
    expect(component.selectedTags).toEqual(['magic']);
    expect(component.selectedPromptFilter).toBe('');
    expect(ids(component.filteredCharacters)).toEqual(['mara']);

    component.tags = [];
    component.selectedPromptFilter = 'with';
    component.selectedTags = [];
    component.applyPreset();
    expect(component.presetNotice).toContain('Tag "Magic"');
    expect(component.presetNotice).toContain('Current filters were kept.');
    expect(component.selectedPromptFilter).toBe('with');
    expect(component.selectedTags).toEqual([]);
    expect(component.savedFilters[0].filters.selectedBook).toBe('book-2');
  });
});
