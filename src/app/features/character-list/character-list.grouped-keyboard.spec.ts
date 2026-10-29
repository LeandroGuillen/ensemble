import { CharacterListComponent } from './character-list.component';

/**
 * Regression: grouped templates used to compare the flat selectedCharacterIndex
 * against each group's local $index, so Down highlighted one card per group and
 * Enter opened the wrong character.
 */
describe('CharacterListComponent grouped keyboard navigation', () => {
  let component: CharacterListComponent;
  let editCharacter: jasmine.Spy;
  let scrollToSelectedCharacter: jasmine.Spy;

  beforeEach(() => {
    editCharacter = jasmine.createSpy('editCharacter');
    scrollToSelectedCharacter = jasmine.createSpy('scrollToSelectedCharacter');

    const alba = { id: 'alba', name: 'Alba', category: 'alpha' };
    const carla = { id: 'carla', name: 'Carla', category: 'alpha' };
    const bruno = { id: 'bruno', name: 'Bruno', category: 'beta' };
    const dora = { id: 'dora', name: 'Dora', category: 'beta' };

    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      filteredCharacters: [alba, carla, bruno, dora],
      groupBy: 'category',
      groupedCharacters: [
        { categoryId: 'alpha', characters: [alba, carla] },
        { categoryId: 'beta', characters: [bruno, dora] },
      ],
      groupedByTag: [],
      groupedByCast: [],
      groupedByBook: [],
      selectedCharacterIndex: -1,
      editCharacter,
      scrollToSelectedCharacter,
      createNewCharacter: jasmine.createSpy(),
      toggleViewMode: jasmine.createSpy(),
    });
  });

  function key(keyName: string): KeyboardEvent {
    return {
      key: keyName,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: jasmine.createSpy('preventDefault'),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent;
  }

  it('moves one highlight across groups in on-screen order and Enter opens it', () => {
    // Alba, Carla | Bruno, Dora — Down x3 → Alba, Carla, Bruno
    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedCharacterIndex).toBe(0);
    expect(component.selectedCharacterId).toBe('alba');

    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedCharacterId).toBe('carla');

    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedCharacterId).toBe('bruno');

    component.handleKeyboardEvent(key('Enter'));
    expect(editCharacter).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'bruno', name: 'Bruno' })
    );
  });

  it('builds navigation order from tag/cast/book groups too', () => {
    const a = { id: 'a', name: 'A' };
    const b = { id: 'b', name: 'B' };
    Object.assign(component, {
      groupBy: 'tag',
      groupedByTag: [
        { tagId: 't1', characters: [a] },
        { tagId: 't2', characters: [b] },
      ],
      selectedCharacterIndex: -1,
    });
    component.handleKeyboardEvent(key('ArrowDown'));
    component.handleKeyboardEvent(key('ArrowDown'));
    expect(component.selectedCharacterId).toBe('b');
    expect(component.getNavigationCharacters().map((c) => c.id)).toEqual(['a', 'b']);
  });
});
