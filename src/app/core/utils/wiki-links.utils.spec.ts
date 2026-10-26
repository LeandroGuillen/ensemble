import { buildWikiLinkTargets, WikiLinkCollection } from './wiki-links.utils';

describe('buildWikiLinkTargets', () => {
  const characters = (targets: any[]): WikiLinkCollection =>
    ({ targets, folder: 'characters', route: 'character', singular: 'Character' });
  const houses: WikiLinkCollection = {
    targets: [{ id: 'house-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' }],
    folder: 'houses', route: 'house', singular: 'House',
  };

  it('resolves links and sends missing ones to the first collection', () => {
    const { resolve } = buildWikiLinkTargets([characters([{ id: 'ben', name: 'Ben', relativePath: 'ben/ben.md' }]), houses]);
    expect(resolve('Ben')).toEqual(jasmine.objectContaining({ state: 'resolved', href: '#/character/ben' }));
    expect(resolve('houses/bulanco/bulanco')).toEqual(jasmine.objectContaining({ state: 'resolved', href: '#/house/house-id' }));
    expect(resolve('Missing')).toEqual(jasmine.objectContaining({ state: 'missing', href: '#/character?name=Missing&fromLink=1' }));
    expect(resolve('houses/new-house')).toEqual(jasmine.objectContaining({ state: 'missing', href: '#/house?name=new-house&fromLink=1' }));

    const fromHouse = buildWikiLinkTargets([houses, characters([])]);
    expect(fromHouse.resolve('Missing').href).toBe('#/house?name=Missing&fromLink=1');
  });

  it('suggests names and aliases', () => {
    const { suggestions } = buildWikiLinkTargets([characters([{ id: 'ben', name: 'Ben', aliases: ['Benny'], relativePath: 'ben/ben.md' }]), houses]);
    expect(suggestions).toEqual([
      jasmine.objectContaining({ label: 'Ben', target: 'Ben', type: 'character' }),
      jasmine.objectContaining({ label: 'Benny', target: 'Ben', detail: '→ Ben' }),
      jasmine.objectContaining({ label: 'Bulanco', target: 'Bulanco', type: 'house' }),
    ]);
  });

  it('links duplicate names by path', () => {
    const { suggestions } = buildWikiLinkTargets([characters([
      { id: 'a', name: 'Ash', relativePath: 'ash/ash.md' },
      { id: 'b', name: 'Ash', relativePath: 'ash-2/ash-2.md' },
    ])]);
    expect(suggestions.map((s) => s.target)).toEqual(['characters/ash/ash', 'characters/ash-2/ash-2']);
  });
});
