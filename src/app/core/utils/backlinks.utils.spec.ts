import {
  buildBacklinkIndex,
  collectionsFrom,
  excludedCountFor,
  groupBacklinks,
  snippetFor,
  targetRefersToName,
  BacklinkSourceDoc,
} from './backlinks.utils';
import { extractWikiLinks } from './wiki-links.utils';

const collections = collectionsFrom({
  characters: [
    { id: 'c-mara', name: 'Mara Vell', relativePath: 'mara-vell.md' },
    { id: 'c-oren', name: 'Oren Vell', relativePath: 'oren-vell.md' },
  ],
  locations: [{ id: 'l-port', name: 'Port Saltmere', relativePath: '_port-saltmere.md' }],
  houses: [{ id: 'h-vell', name: 'House Vell', relativePath: 'vell/vell.md' }],
});

function doc(partial: Partial<BacklinkSourceDoc> & { content: string }): BacklinkSourceDoc {
  return {
    sourceType: 'character',
    sourceId: 'src',
    sourceName: 'Source',
    href: '#/character/src',
    ...partial,
  };
}

describe('extractWikiLinks', () => {
  it('finds links and splits target from label', () => {
    const spans = extractWikiLinks('Meet [[Mara Vell]] and [[House Vell|the House]].');
    expect(spans.map((s) => s.target)).toEqual(['Mara Vell', 'House Vell']);
    expect(spans.map((s) => s.label)).toEqual(['Mara Vell', 'the House']);
  });

  it('skips embeds, escapes and links inside code', () => {
    expect(extractWikiLinks('![[Mara Vell]]').length).toBe(0);
    expect(extractWikiLinks('`[[InCode]]` [[Real]]').map((s) => s.target)).toEqual(['Real']);
    expect(extractWikiLinks('```\n[[InBlock]]\n```').length).toBe(0);
  });

  it('reports span offsets that locate the link in the source', () => {
    const content = 'abc [[Mara Vell]] xyz';
    const [span] = extractWikiLinks(content);
    expect(content.slice(span.start, span.end)).toBe('[[Mara Vell]]');
  });
});

describe('buildBacklinkIndex', () => {
  it('attributes a resolved link to the target record with a snippet', () => {
    const index = buildBacklinkIndex(
      [doc({ content: 'The keeper [[Mara Vell]] lights the beacon.', sourceName: 'Oren Vell' })],
      collections
    );
    const backlinks = index.byTargetId['c-mara'];
    expect(backlinks.length).toBe(1);
    expect(backlinks[0].sourceName).toBe('Oren Vell');
    expect(backlinks[0].snippet).toContain('[Mara Vell]');
    expect(index.excluded.length).toBe(0);
  });

  it('resolves locations and Houses and keys them by id', () => {
    const index = buildBacklinkIndex(
      [doc({ content: 'Sailed from [[Port Saltmere]] under [[House Vell]].' })],
      collections
    );
    expect(index.byTargetId['l-port'].length).toBe(1);
    expect(index.byTargetId['h-vell'].length).toBe(1);
  });

  it('excludes missing links and counts them', () => {
    const index = buildBacklinkIndex([doc({ content: 'A [[Ghost]] appears.' })], collections);
    expect(index.byTargetId['c-mara']).toBeUndefined();
    expect(index.excluded.length).toBe(1);
    expect(index.excluded[0].state).toBe('missing');
  });

  it('excludes ambiguous links (shared names) and counts them', () => {
    const ambiguous = collectionsFrom({
      characters: [
        { id: 's1', name: 'Smith', relativePath: 'a.md' },
        { id: 's2', name: 'Smith', relativePath: 'b.md' },
      ],
      locations: [],
      houses: [],
    });
    const index = buildBacklinkIndex([doc({ content: 'Ask [[Smith]].' })], ambiguous);
    expect(index.excluded.length).toBe(1);
    expect(index.excluded[0].state).toBe('ambiguous');
  });

  it('gathers one backlink per link occurrence across sources', () => {
    const index = buildBacklinkIndex(
      [
        doc({ content: '[[Mara Vell]] is here.', sourceName: 'A' }),
        doc({ content: '[[Mara Vell]] is there.', sourceName: 'B' }),
      ],
      collections
    );
    expect(index.byTargetId['c-mara'].map((b) => b.sourceName)).toEqual(['A', 'B']);
  });
});

describe('snippetFor', () => {
  it('wraps the label in brackets with surrounding context', () => {
    const content = 'The keeper [[Mara Vell]] lights the old beacon at dusk.';
    const [span] = extractWikiLinks(content);
    const snippet = snippetFor(content, span);
    expect(snippet).toContain('[Mara Vell]');
    expect(snippet).toContain('lights');
  });

  it('adds ellipses when the context is cut', () => {
    const long = 'word '.repeat(40) + '[[Mara Vell]]' + ' tail'.repeat(40);
    const spans = extractWikiLinks(long);
    const snippet = snippetFor(long, spans[0]);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('groupBacklinks', () => {
  it('groups by source type in display order and drops empty groups', () => {
    const groups = groupBacklinks([
      { sourceType: 'house', sourceId: 'h', sourceName: 'House', href: '#/house/h', snippet: 'x' },
      { sourceType: 'character', sourceId: 'c', sourceName: 'Char', href: '#/character/c', snippet: 'y' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['character', 'house']);
    expect(groups.map((g) => g.label)).toEqual(['Characters', 'Houses']);
  });
});

describe('excludedCountFor', () => {
  it('counts excluded links that refer to the name or an alias', () => {
    const ambiguous = collectionsFrom({
      characters: [
        { id: 's1', name: 'Smith', relativePath: 'a.md' },
        { id: 's2', name: 'Smith', relativePath: 'b.md' },
      ],
      locations: [],
      houses: [],
    });
    // [[Smith]] is ambiguous (two Smiths); [[Ghost]] is missing. Both are excluded.
    const index = buildBacklinkIndex([doc({ content: '[[Smith]] saw [[Ghost]].' })], ambiguous);
    expect(excludedCountFor(index, 'Smith')).toBe(1);
    expect(excludedCountFor(index, 'Smith', ['Smithe'])).toBe(1);
    expect(excludedCountFor(index, 'Ghost')).toBe(1);
    expect(excludedCountFor(index, 'Unrelated')).toBe(0);
  });

  it('targetRefersToName matches name and aliases case-insensitively', () => {
    expect(targetRefersToName('Mara Vell', 'Mara Vell')).toBe(true);
    expect(targetRefersToName('mara vell', 'Mara Vell')).toBe(true);
    expect(targetRefersToName('the keeper', 'Mara Vell', ['The Keeper'])).toBe(true);
    expect(targetRefersToName('other', 'Mara Vell')).toBe(false);
    // A path-style target is not a name match (it resolves by path instead).
    expect(targetRefersToName('mara-vell.md', 'Mara Vell')).toBe(false);
  });
});

describe('heading backlinks', () => {
  for (const fragment of ['History', '^block']) {
    for (const label of ['', '|the keeper']) {
      it(`attributes ${fragment}${label} with a snippet`, () => {
        const target = `Mara Vell#${fragment}`;
        const index = buildBacklinkIndex([doc({ content: `Meet [[${target}${label}]] today.` })], collections);
        expect(index.byTargetId['c-mara']?.map(b => b.snippet)).toEqual([
          `Meet [${label ? 'the keeper' : target}] today.`
        ]);
        expect(index.excluded).toEqual([]);
      });
      it(`counts unresolved ${fragment}${label} by record name and alias`, () => {
        const index = buildBacklinkIndex([doc({ content: `[[Mara Vell#${fragment}${label}]] [[The Keeper#${fragment}${label}]] [[#${fragment}]]` })],
          collectionsFrom({ characters: [], locations: [], houses: [] }));
        expect(excludedCountFor(index, 'Mara Vell')).toBe(1);
        expect(excludedCountFor(index, 'Mara Vell', ['The Keeper'])).toBe(2);
        expect(excludedCountFor(index, '')).toBe(0);
      });
    }
  }
  it('does not attribute local headings or blocks to a record', () => {
    const index = buildBacklinkIndex([doc({ content: '[[#Mara Vell]] [[#^block]]' })], collections);
    expect(index.byTargetId).toEqual({});
    expect(excludedCountFor(index, 'Mara Vell')).toBe(0);
  });
});
