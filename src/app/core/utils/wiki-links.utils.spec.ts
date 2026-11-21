import { buildWikiLinkTargets, extractWikiLinks, resolveWikiLinkTarget, WikiLinkCollection, wikiLinkRecordName } from './wiki-links.utils';

describe('buildWikiLinkTargets', () => {
  const characters = (targets: any[]): WikiLinkCollection =>
    ({ targets, folder: 'characters', route: 'character', singular: 'Character' });
  const houses: WikiLinkCollection = {
    targets: [{ id: 'house-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' }],
    folder: 'houses', route: 'house', singular: 'House',
  };

  it('indexes preview names once instead of reading every record for every link', () => {
    let reads = 0;
    const targets = Array.from({ length: 2000 }, (_, i) => ({
      id: String(i), relativePath: `person-${i}/person-${i}.md`, aliases: [`Alias#${i}`],
      get name() { reads++; return `Person#${i}`; },
    }));
    const { recordName } = buildWikiLinkTargets([characters(targets)]);
    reads = 0;
    expect(recordName('Person#1999#Heading')).toBe('Person#1999');
    expect(recordName('Alias#1999#Heading')).toBe('Alias#1999');
    expect(recordName('Missing#Heading')).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('keeps indexed preview readings equivalent to the navigation resolver', () => {
    const collections = [characters([
      { id: 'a', name: 'Unit#7', relativePath: 'unit/unit.md', aliases: ['Seven#7'] },
      { id: 'b', name: 'Unit#7', relativePath: 'other/other.md' },
      { id: 'c', name: 'Seven', relativePath: 'seven/seven.md' },
    ]), houses, {
      ...characters([{ id: 'd', name: 'Draft#1', relativePath: '@drafts/d/d.md', aliases: ['Seven#7'] }]),
      secondary: true,
    }, { ...houses, folder: 'characters/nested', targets: [] }];
    const { recordName } = buildWikiLinkTargets(collections);
    for (const target of ['Unit#7', 'Unit#7#Heading', 'Seven#7', 'Seven#Heading',
      'characters/unit/unit.md#Heading', './CHARACTERS\\unit\\unit.md#Heading',
      'characters/nested/unit/unit', '@drafts/d/d#Heading', 'Draft#1', 'houses/Bulanco',
      'Missing#Heading', 'Seven#7#Heading', '', '#Heading']) {
      expect(recordName(target)).withContext(target).toBe(wikiLinkRecordName(target, collections));
    }
  });

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

  it('lets a primary record win a shared name over a secondary collection, which keeps its path', () => {
    const drafts = (targets: any[]): WikiLinkCollection =>
      ({ targets, folder: 'characters', route: 'character-draft', singular: 'Draft', secondary: true });
    const { resolve, suggestions } = buildWikiLinkTargets([
      characters([{ id: 'ash', name: 'Ash', relativePath: 'ash/ash.md' }]),
      drafts([{ id: 'ash-draft', name: 'Ash', relativePath: '@drafts/ash/ash.md' }]),
    ]);
    expect(resolve('Ash')).toEqual(jasmine.objectContaining({ state: 'resolved', href: '#/character/ash' }));
    expect(resolve('characters/@drafts/ash/ash')).toEqual(jasmine.objectContaining({ state: 'resolved', href: '#/character-draft/ash-draft' }));
    expect(resolve('@drafts/ash/ash')).toEqual(jasmine.objectContaining({ state: 'resolved', href: '#/character-draft/ash-draft' }));
    expect(suggestions.map((s) => s.target)).toEqual(['Ash', 'characters/@drafts/ash/ash']);
    // Missing links, even under the shared folder, are never created as drafts.
    expect(resolve('characters/@drafts/new/new').href).toBe('#/character?name=new&fromLink=1');
    const draftFirst = buildWikiLinkTargets([drafts([]), characters([])]);
    expect(draftFirst.resolve('Missing').href).toBe('#/character?name=Missing&fromLink=1');
  });

  it('links duplicate names by path', () => {
    const { suggestions } = buildWikiLinkTargets([characters([
      { id: 'a', name: 'Ash', relativePath: 'ash/ash.md' },
      { id: 'b', name: 'Ash', relativePath: 'ash-2/ash-2.md' },
    ])]);
    expect(suggestions.map((s) => s.target)).toEqual(['characters/ash/ash', 'characters/ash-2/ash-2']);
  });
});

describe('resolveWikiLinkTarget', () => {
  const harbor = { id: 'harbor-id', name: 'Grey Harbor', relativePath: 'grey-harbor/grey-harbor.md' };
  const woods = { id: 'woods-id', name: 'Woods', relativePath: 'north/_woods.md' };
  const otherWoods = { ...woods, id: 'other', relativePath: 'south/_woods.md' };
  const characters = (targets: any[], folder = 'characters'): WikiLinkCollection =>
    ({ targets, folder, route: 'character', singular: 'Character' });
  const houses: WikiLinkCollection = { targets: [{ id: 'house-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' }], folder: 'houses', route: 'house', singular: 'House' };
  const locations: WikiLinkCollection = { targets: [{ id: 'location-id', name: 'Harbor', relativePath: '_harbor.md' }], folder: 'locations', route: 'location', singular: 'Location' };
  const idOf = (target: string, collections: WikiLinkCollection[]) => {
    const link = resolveWikiLinkTarget(target, collections);
    return link.state === 'resolved' ? link.id : link.state;
  };

  it('resolves display names and file paths with optional extensions, folder prefixes and Windows separators', () => {
    for (const target of ['Grey Harbor', 'grey harbor', 'grey-harbor', 'grey-harbor.md', 'grey-harbor/grey-harbor.md', 'characters/grey-harbor/grey-harbor.md']) {
      expect(idOf(target, [characters([harbor])])).withContext(target).toBe('harbor-id');
    }
    expect(idOf('places/north/_woods.md', [characters([woods], 'places')])).toBe('woods-id');
    expect(idOf('_woods', [characters([woods])])).toBe('woods-id');
    expect(idOf('world\\places\\_harbor.md', [characters([]), { ...locations, folder: 'world/places' }])).toBe('location-id');
  });

  it('does not guess between duplicates or across types; paths and folders disambiguate', () => {
    expect(idOf('Woods', [characters([woods, otherWoods])])).toBe('ambiguous');
    expect(idOf('_woods', [characters([woods, otherWoods])])).toBe('ambiguous');
    expect(idOf('Woods#History', [characters([woods, otherWoods])])).toBe('ambiguous');
    expect(idOf('north/_woods', [characters([woods, otherWoods])])).toBe('woods-id');
    const all = [characters([{ id: 'character-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' }]), houses, locations];
    expect(idOf('Bulanco', all)).toBe('ambiguous');
    expect(idOf('houses/bulanco/bulanco.md', all)).toBe('house-id');
    expect(idOf('characters/bulanco/bulanco', all)).toBe('character-id');
    expect(idOf('locations/_harbor.md', all)).toBe('location-id');
    expect(idOf('Harbor', all)).toBe('location-id');
  });

  it('sends missing links to the creation page of their folder, named by target or filename', () => {
    const collections = [characters([]), houses, locations];
    expect(resolveWikiLinkTarget('Cove & Bay?fromLink=0', collections).href).toBe('#/character?name=Cove%20%26%20Bay%3FfromLink%3D0&fromLink=1');
    expect(resolveWikiLinkTarget('houses/new-house/new-house.md', collections).href).toBe('#/house?name=new-house&fromLink=1');
    expect(resolveWikiLinkTarget('locations/_cove.md', collections).href).toBe('#/location?name=_cove&fromLink=1');
  });
});

describe('heading wiki-links', () => {
  const targets = [{ id: 'mara', name: 'Mara Vell', relativePath: 'mara.md' }];
  const options = { folder: 'characters', route: 'character', singular: 'Character' };
  for (const fragment of ['History', '^block']) {
    for (const label of ['', '|the keeper']) {
      it(`resolves ${fragment}${label}`, () => {
        const [span] = extractWikiLinks(`[[Mara Vell#${fragment}${label}]]`);
        expect(buildWikiLinkTargets([{ ...options, targets }]).resolve(span.target)).toEqual(
          jasmine.objectContaining({ state: 'resolved', id: 'mara', href: '#/character/mara', fragment }));
      });
    }
  }
  it('keeps local fragments unattributed', () => {
    const { resolve } = buildWikiLinkTargets([{ ...options, targets }]);
    expect(resolve('#Local heading').state).toBe('ambiguous');
    expect(resolve('#^block').state).toBe('ambiguous');
    expect(resolve('Ghost').state).toBe('missing');
  });
});

describe('names containing #', () => {
  const characters = (targets: any[]): WikiLinkCollection =>
    ({ targets, folder: 'characters', route: 'character', singular: 'Character' });
  const unit7 = { id: 'unit-7', name: 'Unit #7', relativePath: 'unit-7/unit-7.md' };
  const unit = { id: 'unit', name: 'Unit', relativePath: 'unit/unit.md' };

  it('suggests a path target for names with #, |, [ or ], shown with the name', () => {
    const { suggestions, resolve } = buildWikiLinkTargets([characters([
      unit7, unit,
      { id: 'pipe', name: 'A|B', relativePath: 'a-b/a-b.md' },
      { id: 'bracket', name: 'Subject [12]', relativePath: 'subject-12/subject-12.md' },
    ])]);
    expect(suggestions.map((s) => [s.label, s.target])).toEqual([
      ['Unit #7', 'characters/unit-7/unit-7'],
      ['Unit', 'Unit'],
      ['A|B', 'characters/a-b/a-b'],
      ['Subject [12]', 'characters/subject-12/subject-12'],
    ]);
    // The inserted `[[target|name]]` (brackets dropped from the display text) links to the picked record.
    for (const suggestion of suggestions) {
      const inserted = `[[${suggestion.target}|${suggestion.label.replace(/[\[\]]/g, '')}]]`;
      const [span] = extractWikiLinks(inserted);
      expect(span.end).toBe(inserted.length);
      expect(resolve(span.target).state).withContext(inserted).toBe('resolved');
    }
    expect(suggestions.map((s) => resolve(s.target).id)).toEqual(['unit-7', 'unit', 'pipe', 'bracket']);
    expect(resolve('characters/unit-7/unit-7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7' }));
  });

  it('resolves a hand-written [[Unit #7]] alone', () => {
    const targets = [unit7];
    const { resolve } = buildWikiLinkTargets([characters(targets)]);
    expect(resolve('Unit #7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7', href: '#/character/unit-7' }));
    expect(resolve('Unit #7').fragment).toBeUndefined();
  });

  it('resolves [[Unit #7]] to Unit #7, never to a record named like its prefix', () => {
    const targets = [unit, unit7];
    const { resolve } = buildWikiLinkTargets([characters(targets)]);
    expect(resolve('Unit #7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7' }));
    expect(resolve('unit #7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7' }));
    // A heading inside Unit #7, and a real heading link to Unit.
    expect(resolve('Unit #7#Origins')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7', fragment: 'Origins' }));
    expect(resolve('Unit#Origins')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit', fragment: 'Origins' }));
  });

  it('prefers Unit #7 in another collection over a character named Unit', () => {
    const { resolve } = buildWikiLinkTargets([characters([unit]),
      { targets: [{ ...unit7, id: 'loc-7', relativePath: '_unit-7.md' }], folder: 'locations', route: 'location', singular: 'Location' }]);
    expect(resolve('Unit #7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'loc-7', href: '#/location/loc-7' }));
  });

  it('reads [[Unit #7]] as a heading link to Unit when no Unit #7 exists', () => {
    const { resolve } = buildWikiLinkTargets([characters([unit])]);
    expect(resolve('Unit #7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit', fragment: '7' }));
  });
});

describe('old names retained as wiki-link aliases', () => {
  it('resolves unique aliases for characters, locations and Houses', () => {
    for (const route of ['character', 'location', 'house']) {
      const collections = [{ folder: route + 's', route, singular: route, targets: [
        { id: 'one', name: 'New name', relativePath: 'new.md', aliases: ['Old name'] },
      ] }];
      expect(resolveWikiLinkTarget('Old name#History', collections)).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'one', fragment: 'History' }));
      collections[0].targets.push({ id: 'two', name: 'Another', relativePath: 'another.md', aliases: ['Old name'] });
      expect(resolveWikiLinkTarget('Old name', collections).state).toBe('ambiguous');
    }
  });
});

describe('wiki-link alias fallback precedence', () => {
  const ilse = { id: 'ilse', name: 'Ilse', relativePath: 'ilse/ilse.md' };
  const other = { id: 'other', name: 'Other', relativePath: 'other/other.md', aliases: ['Ilse', 'ilse/ilse', 'Ilse#History'] };
  const characters = (targets: any[], secondary = false): WikiLinkCollection => ({ folder: 'characters', route: secondary ? 'character-draft' : 'character', singular: 'Character', targets, secondary });

  it('preserves canonical names, paths and heading links when another record has matching aliases', () => {
    const entries = [ilse, other];
    const links = buildWikiLinkTargets([characters(entries)]);
    for (const target of ['Ilse', 'ilse/ilse', 'characters/ilse/ilse.md', 'Ilse#History']) {
      expect(links.resolve(target)).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'ilse' }));
    }
    expect(links.resolve('Ilse#History').fragment).toBe('History');
    expect(links.suggestions.find(entry => entry.label === 'Ilse' && entry.detail === 'Character')?.target).toBe('Ilse');
  });

  it('preserves House and location names regardless of collection order or character aliases', () => {
    for (const route of ['house', 'location']) {
      const named: WikiLinkCollection = { folder: route + 's', route, singular: route, targets: [{ id: 'named', name: 'Ilse', relativePath: 'named.md' }] };
      for (const collections of [[characters([other]), named], [named, characters([other])]]) {
        const links = buildWikiLinkTargets(collections);
        expect(links.resolve('Ilse')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'named', route }));
        expect(links.suggestions.find(entry => entry.label === 'Ilse' && entry.type === route)?.target).toBe('Ilse');
      }
    }
  });

  it('preserves primary and secondary rules before falling back to aliases', () => {
    const draft = { ...ilse, id: 'draft', relativePath: '@drafts/ilse/ilse.md' };
    const aliasesOnly = characters([other]);
    expect(buildWikiLinkTargets([aliasesOnly, characters([draft], true)]).resolve('Ilse').id).toBe('draft');
    expect(buildWikiLinkTargets([characters([ilse, other]), characters([draft], true)]).resolve('Ilse').id).toBe('ilse');
    expect(buildWikiLinkTargets([aliasesOnly, characters([{ ...draft, name: 'Draft', relativePath: '@drafts/draft/draft.md', aliases: ['Ilse'] }], true)]).resolve('Ilse').id).toBe('other');
  });
});
