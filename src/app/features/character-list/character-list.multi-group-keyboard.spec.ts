import { CharacterListComponent } from './character-list.component';
import { CharacterGridViewComponent } from './views/character-grid-view/character-grid-view.component';
import { CharacterListViewComponent } from './views/character-list-view/character-list-view.component';
import { CharacterCompactViewComponent } from './views/character-compact-view/character-compact-view.component';
import { CharacterGalleryViewComponent } from './views/character-gallery-view/character-gallery-view.component';

/**
 * Regression for Tag/Cast/Book: a character in two groups appears twice in the
 * flattened nav list. Highlighting by character id selected both cards; Down
 * looked stuck. Selection must be per occurrence (nav index).
 */
describe('CharacterListComponent multi-group keyboard highlight', () => {
  let component: CharacterListComponent;
  let editCharacter: jasmine.Spy;
  let scrollToSelectedCharacter: jasmine.Spy;

  const alba = { id: 'alba', name: 'Alba' };
  const bruno = { id: 'bruno', name: 'Bruno' };
  const carla = { id: 'carla', name: 'Carla' };
  const dora = { id: 'dora', name: 'Dora' };

  beforeEach(() => {
    editCharacter = jasmine.createSpy('editCharacter');
    scrollToSelectedCharacter = jasmine.createSpy('scrollToSelectedCharacter');

    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      filteredCharacters: [alba, bruno, carla, dora],
      groupBy: 'tag',
      groupedCharacters: [],
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

  /** Count cards that would show .selected using occurrence highlighting. */
  function countOccurrenceHighlights(
    groups: Array<{ characters: Array<{ id: string }> }>
  ): number {
    let count = 0;
    let offset = 0;
    for (const group of groups) {
      for (let i = 0; i < group.characters.length; i++) {
        if (component.isNavOccurrenceHighlighted(offset, i)) {
          count++;
        }
      }
      offset += group.characters.length;
    }
    return count;
  }

  /** Old (broken) highlight count: every card whose id matches selectedCharacterId. */
  function countIdHighlights(
    groups: Array<{ characters: Array<{ id: string }> }>
  ): number {
    const id = component.selectedCharacterId;
    if (!id) return 0;
    return groups.reduce(
      (n, g) => n + g.characters.filter((c) => c.id === id).length,
      0
    );
  }

  function occurrenceCount(
    groups: Array<{ characters: Array<{ id: string }> }>,
    id: string
  ): number {
    return groups.reduce((n, g) => n + g.characters.filter((c) => c.id === id).length, 0);
  }

  function expectOneHighlightAndId(
    groups: Array<{ characters: Array<{ id: string }> }>,
    expectedId: string
  ): void {
    expect(countOccurrenceHighlights(groups)).toBe(1);
    expect(component.selectedCharacterId).toBe(expectedId);
    // Documents the bug: id-based selection would light up every copy.
    if (occurrenceCount(groups, expectedId) > 1) {
      expect(countIdHighlights(groups)).toBeGreaterThan(1);
    }
  }

  it('Tag grouping: Down walks each Bruno occurrence separately', () => {
    // Brave: Alba, Bruno | Sly: Dora, Bruno, Carla
    // Observed broken sequence highlighted bruno+bruno; expected one at a time.
    const groups = [
      { tagId: 'brave', characters: [alba, bruno] },
      { tagId: 'sly', characters: [dora, bruno, carla] },
    ];
    Object.assign(component, { groupBy: 'tag', groupedByTag: groups });

    const sequence = ['alba', 'bruno', 'dora', 'bruno', 'carla'];
    for (const expectedId of sequence) {
      component.handleKeyboardEvent(key('ArrowDown'));
      expectOneHighlightAndId(groups, expectedId);
    }

    component.handleKeyboardEvent(key('Enter'));
    expect(editCharacter).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'carla' })
    );
  });

  it('Cast grouping: Down walks each Bruno occurrence separately', () => {
    // Crew: Alba, Bruno | Rivals: Bruno, Dora, Carla
    const groups = [
      { castId: 'crew', characters: [alba, bruno] },
      { castId: 'rivals', characters: [bruno, dora, carla] },
    ];
    Object.assign(component, { groupBy: 'cast', groupedByCast: groups });

    const sequence = ['alba', 'bruno', 'bruno', 'dora', 'carla'];
    for (const expectedId of sequence) {
      component.handleKeyboardEvent(key('ArrowDown'));
      expectOneHighlightAndId(groups, expectedId);
    }
  });

  it('Book grouping: Down walks each Alba occurrence separately', () => {
    // One: Alba, Carla | Two: Alba, Dora, Bruno
    const groups = [
      { bookId: 'one', characters: [alba, carla] },
      { bookId: 'two', characters: [alba, dora, bruno] },
    ];
    Object.assign(component, { groupBy: 'book', groupedByBook: groups });

    const sequence = ['alba', 'carla', 'alba', 'dora', 'bruno'];
    for (const expectedId of sequence) {
      component.handleKeyboardEvent(key('ArrowDown'));
      expectOneHighlightAndId(groups, expectedId);
    }
  });

  it('getGroupNavOffset and wrap-around stay occurrence-based', () => {
    const groups = [
      { tagId: 'brave', characters: [alba, bruno] },
      { tagId: 'sly', characters: [bruno] },
    ];
    Object.assign(component, { groupBy: 'tag', groupedByTag: groups });

    expect(component.getGroupNavOffset(0)).toBe(0);
    expect(component.getGroupNavOffset(1)).toBe(2);

    component.handleKeyboardEvent(key('ArrowDown')); // alba @0
    component.handleKeyboardEvent(key('ArrowDown')); // bruno @1
    component.handleKeyboardEvent(key('ArrowDown')); // bruno @2
    expect(component.selectedCharacterIndex).toBe(2);
    expect(component.isNavOccurrenceHighlighted(2, 0)).toBeTrue();
    expect(component.isNavOccurrenceHighlighted(0, 1)).toBeFalse();

    component.handleKeyboardEvent(key('ArrowDown')); // wrap to alba @0
    expect(component.selectedCharacterIndex).toBe(0);
  });
});

describe('Character views highlight by nav occurrence not id', () => {
  const viewCtors = [
    CharacterGridViewComponent,
    CharacterListViewComponent,
    CharacterCompactViewComponent,
    CharacterGalleryViewComponent,
  ];

  for (const Ctor of viewCtors) {
    it(`${Ctor.name} selects only the matching occurrence index`, () => {
      const view = Object.create(Ctor.prototype) as {
        selectedNavIndex: number;
        navIndexOffset: number;
        isOccurrenceSelected: (i: number) => boolean;
      };
      Object.assign(view, { selectedNavIndex: 3, navIndexOffset: 2 });
      // Cards in this group: local 0 → nav 2, local 1 → nav 3 (selected)
      expect(view.isOccurrenceSelected(0)).toBeFalse();
      expect(view.isOccurrenceSelected(1)).toBeTrue();
      expect(view.isOccurrenceSelected(2)).toBeFalse();
    });
  }
});
