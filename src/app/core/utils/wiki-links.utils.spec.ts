import { buildWikiLinkTargets, extractWikiLinks, renderWikiLinkMarkdown, resolveWikiLink, resolveWikiLinkTarget, WikiLinkCollection, wikiLinkRecordName } from './wiki-links.utils';

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

describe('heading wiki-links', () => {
  const targets = [{ id: 'mara', name: 'Mara Vell', relativePath: 'mara.md' }];
  const options = { folder: 'characters', route: 'character', singular: 'Character' };
  for (const fragment of ['History', '^block']) {
    for (const label of ['', '|the keeper']) {
      it(`resolves and renders ${fragment}${label}`, () => {
        const target = `Mara Vell#${fragment}`;
        expect(resolveWikiLink(target, targets, options.folder)).toEqual(targets[0]);
        expect(buildWikiLinkTargets([{ ...options, targets }]).resolve(target)).toEqual(
          jasmine.objectContaining({ state: 'resolved', id: 'mara', href: '#/character/mara', fragment }));
        const rendered = renderWikiLinkMarkdown(`[[${target}${label}]]`, targets, options);
        expect(rendered.html).toContain(`<a href="#/character/mara" title="${target}">${label ? 'the keeper' : target}</a>`);
        expect(rendered.missingLinks).toEqual([]);
      });
    }
  }
  it('keeps local fragments unattributed and ordinary renderer output unchanged', () => {
    const { resolve } = buildWikiLinkTargets([{ ...options, targets }]);
    expect(resolve('#Local heading').state).toBe('ambiguous');
    expect(resolve('#^block').state).toBe('ambiguous');
    expect(renderWikiLinkMarkdown('[[Mara Vell|keeper]]', targets, options).html)
      .toBe('<p><a href="#/character/mara" title="Mara Vell">keeper</a></p>');
    expect(renderWikiLinkMarkdown('[[Ghost]]', targets, options).missingLinks).toEqual(['Ghost']);
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
    expect(resolveWikiLink('Unit #7', targets, 'characters')).toEqual(unit7);
    expect(renderWikiLinkMarkdown('[[Unit #7]]', targets, characters([])).html)
      .toBe('<p><a href="#/character/unit-7" title="Unit #7">Unit #7</a></p>');
  });

  it('resolves [[Unit #7]] to Unit #7, never to a record named like its prefix', () => {
    const targets = [unit, unit7];
    const { resolve } = buildWikiLinkTargets([characters(targets)]);
    expect(resolve('Unit #7')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7' }));
    expect(resolveWikiLink('unit #7', targets, 'characters')).toEqual(unit7);
    // A heading inside Unit #7, and a real heading link to Unit.
    expect(resolve('Unit #7#Origins')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit-7', fragment: 'Origins' }));
    expect(resolve('Unit#Origins')).toEqual(jasmine.objectContaining({ state: 'resolved', id: 'unit', fragment: 'Origins' }));
    expect(resolveWikiLink('Unit#Origins', targets, 'characters')).toEqual(unit);
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
      expect(resolveWikiLink(target, entries, 'characters')).toBe(ilse);
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
