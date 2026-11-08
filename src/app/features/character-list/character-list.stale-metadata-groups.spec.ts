import { Character } from '../../core/interfaces/character.interface';
import { CharacterListComponent } from './character-list.component';

/**
 * Regression: grouping by Category or Tag dropped characters whose category id
 * or every tag id was no longer in project metadata (e.g. deleted in Settings),
 * so they vanished from the grouped list while still showing in Flat.
 */
describe('CharacterListComponent grouping with stale category/tag ids', () => {
  let component: CharacterListComponent;

  const make = (id: string, category: string, tags: string[], extra: Partial<Character> = {}): Character =>
    ({ id, name: id, category, tags, books: [], ...extra }) as unknown as Character;

  const mara = make('mara', 'main', ['magic']);
  const ilse = make('ilse', 'antagonist', ['magic']); // category deleted
  const saffi = make('saffi', 'supporting', ['tide-touched']); // only tag deleted
  const orin = make('orin', '', ['tide-touched', 'magic']); // one stale, one known tag
  const tova = make('tova', 'main', [], { bookCategories: { b1: 'antagonist' } }); // stale per-book override
  const all = [mara, ilse, saffi, orin, tova];

  const groupByCategory = (): Array<{ categoryId: string; characters: Character[] }> =>
    (component as any).computeGroupedCharacters();
  const groupByTag = (): Array<{ tagId: string; characters: Character[] }> =>
    (component as any).computeGroupedByTag();
  const ids = (chars: Character[]) => chars.map((c) => c.id);
  const uniqueIds = (groups: Array<{ characters: Character[] }>) =>
    new Set(groups.flatMap((group) => ids(group.characters)));

  beforeEach(() => {
    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      filteredCharacters: all,
      categories: [
        { id: 'main', name: 'Main' },
        { id: 'supporting', name: 'Supporting' },
      ],
      tags: [{ id: 'magic', name: 'Magic' }],
      selectedBook: '',
    });
  });

  it('puts a character whose category was deleted under Uncategorized', () => {
    const groups = groupByCategory();
    expect(groups.map((g) => g.categoryId)).toEqual(['main', 'supporting', 'uncategorized']);
    expect(ids(groups.find((g) => g.categoryId === 'uncategorized')!.characters)).toEqual(['ilse', 'orin']);
    expect(groups.some((g) => g.categoryId === 'antagonist')).toBeFalse();
  });

  it('uses Uncategorized for a stale per-book category override when that book is selected', () => {
    Object.assign(component, { selectedBook: 'b1' });
    const groups = groupByCategory();
    expect(ids(groups.find((g) => g.categoryId === 'uncategorized')!.characters)).toContain('tova');
    expect(ids(groups.find((g) => g.categoryId === 'main')!.characters)).toEqual(['mara']);
  });

  it('puts a character whose only tags were deleted under Untagged', () => {
    const groups = groupByTag();
    expect(groups.map((g) => g.tagId)).toEqual(['magic', 'untagged']);
    expect(ids(groups.find((g) => g.tagId === 'untagged')!.characters)).toEqual(['saffi', 'tova']);
    // A known tag alongside a stale one keeps the character under the known tag only.
    expect(ids(groups.find((g) => g.tagId === 'magic')!.characters)).toEqual(['mara', 'ilse', 'orin']);
  });

  it('shows the same unique characters in Flat, Category and Tag views', () => {
    const flat = new Set(ids(all));
    expect(uniqueIds(groupByCategory())).toEqual(flat);
    expect(uniqueIds(groupByTag())).toEqual(flat);
  });

  it('keyboard navigation reaches characters with stale ids in grouped views', () => {
    Object.assign(component, {
      groupBy: 'category',
      groupedCharacters: groupByCategory(),
      groupedByTag: groupByTag(),
    });
    expect(component.getNavigationCharacters().map((c) => c.id)).toContain('ilse');
    Object.assign(component, { groupBy: 'tag' });
    expect(component.getNavigationCharacters().map((c) => c.id)).toContain('saffi');
  });
  it('does not rewrite a stale category when dropped back into Uncategorized', async () => {
    const updateCharacter = jasmine.createSpy('updateCharacter');
    const container = {};
    Object.assign(component, {
      characterService: { updateCharacter },
      notificationService: jasmine.createSpyObj('NotificationService', ['showError', 'showSuccess']),
      logger: jasmine.createSpyObj('Logger', ['error']),
      metadataHelper: { getCategoryName: (id: string) => id },
      isOverDrawerDropPoint: () => false,
      isCategoryDragDropEnabled: () => true,
      updateCategoryDropListIds: () => undefined,
    });
    await component.onCategoryDrop(
      { item: { data: ilse }, container, previousContainer: container } as any,
      'uncategorized'
    );
    expect(updateCharacter).not.toHaveBeenCalled();
  });
});
