import { buildWikiLinkTargets, extractWikiLinks, renderWikiLinkMarkdown, resolveWikiLink, WikiLinkCollection } from './wiki-links.utils';

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
