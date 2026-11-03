import { buildWikiLinkTargets, renderWikiLinkMarkdown, resolveWikiLink, WikiLinkCollection } from './wiki-links.utils';

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
