import { CharacterPickerService } from './character-picker.service';

describe('CharacterPickerService Lore', () => {
  it('includes reference figures with a clear Lore label and returns the selected record', async () => {
    const figure = { id: 'founder', name: 'Founder', lore: true, category: '', tags: [], aliases: ['First King'] };
    const character = { id: 'hero', name: 'Hero', category: 'people', tags: [] };
    const palette = { pick: jasmine.createSpy('pick').and.resolveTo({ id: 'pick-founder' }) };
    const characters = {
      getReferenceCharactersSnapshot: () => [figure, character],
      loadThumbnailsForCharacters: jasmine.createSpy().and.resolveTo(),
      getCachedThumbnail: () => null,
    };
    const service = new CharacterPickerService(palette as any, characters as any, {
      getCurrentProject: () => null, getDefaultCharacterStyle: () => 'default',
    } as any, { getCategoryName: (id: string) => id, getTagName: (id: string) => id } as any);

    expect(await service.pick()).toBe(figure as any);
    const commands = palette.pick.calls.mostRecent().args[0];
    expect(commands[0].metadata).toBe('Lore');
    expect(commands[0].aliases).toEqual(['First King']);
    expect(commands[1].metadata).toBe('people');
  });
});
