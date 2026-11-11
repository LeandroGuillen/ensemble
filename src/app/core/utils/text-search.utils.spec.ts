import { TextDocument, TextSearchIndex } from './text-search.utils';

describe('TextSearchIndex', () => {
  let index: TextSearchIndex;
  const page = (changes: Partial<TextDocument> = {}): TextDocument => ({
    id: 'mara', type: 'Characters', title: 'Mara', text: 'A scar on her left hand.', route: ['/character', 'mara'], ...changes,
  });
  beforeEach(() => index = new TextSearchIndex());

  it('finds body text without a title match, preserving navigation and type', () => {
    index.replace([page(), page({ id: 'harbor', title: 'Harbor', type: 'Locations', text: 'A scar on the cliff.' })]);
    const results = index.search('scar');
    expect(results.map(result => result.type)).toEqual(['Characters', 'Locations']);
    expect(results[0].route).toEqual(['/character', 'mara']);
    expect(results[0].snippet.find(part => part.hit)?.text).toBe('scar');
    expect(index.search(' ')).toEqual([]);
  });

  it('matches accents, case and decomposed accents with correct highlight offsets', () => {
    index.replace([page({ text: '😀 A Jose\u0301 met José at the café.' })]);
    expect(index.search('JOSE')[0].snippet.find(part => part.hit)?.text).toBe('Jose\u0301');
    expect(index.search('cafe')[0].snippet.find(part => part.hit)?.text).toBe('café');
  });

  it('centers a snippet around a late body match and retains its book context', () => {
    index.replace([page({ text: 'Prologue. '.repeat(80) + 'José remembers the scar.',
      book: 'Winter', queryParams: { book: 'winter' } })]);
    const result = index.search('jose')[0];
    expect(result.book).toBe('Winter');
    expect(result.queryParams).toEqual({ book: 'winter' });
    expect(result.snippet[0].text.startsWith('…')).toBeTrue();
    expect(result.snippet.find(part => part.hit)?.text).toBe('José');
  });

  it('replaces changed and deleted pages without retaining stale hits', () => {
    index.replace([page()]);
    expect(index.search('scar').length).toBe(1);
    index.replace([page({ text: 'No distinguishing marks.' })]);
    expect(index.search('scar')).toEqual([]);
    index.replace([]);
    expect(index.search('Mara')).toEqual([]);
  });

  it('queries 1,000 synthetic records, including snippets, in under 200 ms', () => {
    index.replace(Array.from({ length: 1000 }, (_, i) => page({ id: String(i), title: `Person ${i}`,
      text: 'Worldbuilding and history. '.repeat(100) + 'José has a scar on her left hand.' })));
    const start = performance.now();
    const results = index.search('jose');
    const elapsed = performance.now() - start;
    expect(results.length).toBe(1000);
    expect(elapsed).toBeLessThan(200);
  });
});
