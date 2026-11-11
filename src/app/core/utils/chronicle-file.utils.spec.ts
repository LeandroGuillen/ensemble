import {
  ChronicleEntryDraft,
  formatChronicleEntry,
  insertChronicleEntry,
  parseChronicle,
  removeChronicleEntry,
  replaceChronicleEntry,
} from './chronicle-file.utils';
import { DEFAULT_CALENDAR } from './world-date.utils';

const CAL = DEFAULT_CALENDAR;
const TEXT = [
  '---',                                        // 0
  'title: Lantern Coast',                       // 1
  '---',                                        // 2
  '# The Charter Years',                        // 3
  'Salt for passage.',                          // 4
  '',                                           // 5
  '## 240 · The Salt Charter is sealed',        // 6
  'Where: [[Port Saltmere]]',                   // 7
  '',                                           // 8
  'Every ship pays in salt.',                   // 9
  '',                                           // 10
  '# The Dark Harbor',                          // 11
  'From: 322',                                  // 12
  '',                                           // 13
  '## 322-03 · The blackout',                   // 14
  'Where: [[Vellhaven Lighthouse]]',            // 15
  'With: [[Mara Vell]], [[Saffi Reed|Saffi]]',  // 16
  'Book: lc1',                                  // 17
  '',                                           // 18
  'Vellhaven goes dark.',                       // 19
  '',                                           // 20
  '## c. 1 - The First Keeper',                 // 21
  'Kind: legend',                               // 22
  '',                                           // 23
  "## The Grey Pilot's crossing",               // 24
  '',
].join('\n');

describe('chronicle-file.utils', () => {
  it('parses eras, entries, properties and undated headings', () => {
    const parsed = parseChronicle(TEXT, CAL);
    expect(parsed.frontmatter['title']).toBe('Lantern Coast');
    expect(parsed.eras.map((e) => e.title)).toEqual(['The Charter Years', 'The Dark Harbor']);
    expect(parsed.eras[0].description).toBe('Salt for passage.');
    expect(parsed.eras[1].from).toEqual({ start: { year: 322 }, end: null });
    const [charter, blackout, keeper, pilot] = parsed.entries;
    expect(charter).toEqual(jasmine.objectContaining({ title: 'The Salt Charter is sealed', where: ['Port Saltmere'], body: 'Every ship pays in salt.', eraIndex: 0 }));
    expect(blackout).toEqual(jasmine.objectContaining({ dateText: '322-03', with: ['Mara Vell', 'Saffi Reed'], books: ['lc1'], eraIndex: 1, line: 14, endLine: 21 }));
    expect(keeper).toEqual(jasmine.objectContaining({ kind: 'legend', date: { start: { year: 1, approx: true }, end: null } }));
    expect(pilot).toEqual(jasmine.objectContaining({ title: "The Grey Pilot's crossing", date: null, dateInvalid: false }));
  });

  it('marks unreadable dates', () => {
    const entry = parseChronicle('## 322-14 · Bad month\n', CAL).entries[0];
    expect(entry.date).toBeNull();
    expect(entry.dateInvalid).toBeTrue();
  });

  it('formats entries', () => {
    expect(formatChronicleEntry({ date: { start: { year: 330, month: 3, day: 3 }, end: null }, title: 'Wren returns', kind: 'event', where: ['Vellhaven Lighthouse'], with: ['Wren Dunmore', 'Mara Vell'], books: ['lc2'], body: 'A dry girl.' }))
      .toBe('## 330-03-03 · Wren returns\nWhere: [[Vellhaven Lighthouse]]\nWith: [[Wren Dunmore]], [[Mara Vell]]\nBook: lc2\n\nA dry girl.\n');
    expect(formatChronicleEntry({ date: null, title: 'Myth', kind: 'legend', where: [], with: [], books: [], body: '' })).toBe('## ? · Myth\nKind: legend\n');
  });

  // Both editor saves and Quick add must preserve notes without changing structure.
  const noteCases = [
    ...Array.from({ length: 6 }, (_, i) => `${'#'.repeat(i + 1)} Aftermath\nForty boats are still out.`),
    ...['With', 'Where', 'Book', 'Books', 'Kind', 'Type', 'From'].map(
      (key) => `${key}: the keeper's log was lost overboard.\nThirty-nine boats return.`
    ),
    'Vellhaven goes dark.\n\n## Aftermath\nForty boats are still out.',
    'Teodor taxes the light itself.\n\n# Rumors\nSome say Ilse wrote the levy.',
    '  wItH: [[A stranger]]\n\n## Aftermath',
    String.raw`\## Already escaped
With\: already escaped
\\# Another escape`,
    '```markdown\n# An example era\n## An example entry\nWith: [[An example]]\n```\n\n## Aftermath',
  ];
  for (const body of noteCases) {
    for (const action of ['insert', 'replace'] as const) {
      it(`${action} round-trips notes ${JSON.stringify(body)}`, () => {
        const draft: ChronicleEntryDraft = {
          date: { start: { year: 322, month: 3 }, end: null }, title: 'Notes',
          kind: 'legend', where: ['Vellhaven Lighthouse'], with: ['Mara Vell'], books: ['lc1', 'lc2'], body,
        };
        const before = parseChronicle(TEXT, CAL);
        const result = action === 'insert'
          ? insertChronicleEntry(TEXT, draft, CAL)
          : replaceChronicleEntry(TEXT, 14, draft, CAL);
        const after = parseChronicle(result.text, CAL);
        expect(after.eras).toEqual(before.eras.map((era) => jasmine.objectContaining({
          title: era.title, description: era.description, from: era.from,
        })));
        expect(after.entries.length).toBe(before.entries.length + (action === 'insert' ? 1 : 0));
        const saved = after.entries.find((entry) => entry.line === result.line)!;
        expect(saved).toEqual(jasmine.objectContaining(draft));
        // A second save must neither accumulate escapes nor reinterpret notes.
        const again = replaceChronicleEntry(result.text, saved.line, saved, CAL);
        expect(again.text).toBe(result.text);
      });
    }
  }

  for (const title of ['C#', 'Learning C#', 'Wren is lost at Reach #', 'Wren ##', String.raw`Learning C\#`]) {
    for (const date of [null, { start: { year: 322 }, end: null }]) {
      it(`round-trips title ${JSON.stringify(title)} with date ${JSON.stringify(date)}`, () => {
        const draft: ChronicleEntryDraft = { date, title, kind: 'event', where: [], with: [], books: [], body: '' };
        const added = insertChronicleEntry(TEXT, draft, CAL);
        const saved = parseChronicle(added.text, CAL).entries.find((entry) => entry.line === added.line)!;
        expect(saved.title).toBe(title);
        const edited = replaceChronicleEntry(added.text, saved.line, saved, CAL);
        expect(parseChronicle(edited.text, CAL).entries.find((entry) => entry.line === edited.line)!.title).toBe(title);
        expect(edited.text).toBe(added.text);
      });
    }
  }

  it('keeps hand-written closing hashes, spaced properties and fenced headings working', () => {
    const parsed = parseChronicle([
      '# The Dark Harbor #', '', 'From: 322', '',
      '## 322 · The blackout ##', '', 'Where: [[Vellhaven Lighthouse]]', '',
      'With: [[Mara Vell]]', 'Books: lc1, lc2', 'Type: myth', '',
      '### Aftermath', '```markdown', '# Example', '## Example', '```',
    ].join('\n'), CAL);
    expect(parsed.eras.length).toBe(1);
    expect(parsed.eras[0].title).toBe('The Dark Harbor');
    expect(parsed.eras[0].from).toEqual({ start: { year: 322 }, end: null });
    expect(parsed.entries.length).toBe(1);
    expect(parsed.entries[0]).toEqual(jasmine.objectContaining({
      title: 'The blackout', where: ['Vellhaven Lighthouse'], with: ['Mara Vell'],
      books: ['lc1', 'lc2'], kind: 'legend', body: '### Aftermath\n```markdown\n# Example\n## Example\n```',
    }));
  });

  it('inserts entries in date order within their era', () => {
    const draft = { date: { start: { year: 300 }, end: null }, title: 'Mara is born', kind: 'event' as const, where: [], with: [], books: [], body: '' };
    const { text, line } = insertChronicleEntry(TEXT, draft, CAL);
    const parsed = parseChronicle(text, CAL);
    const added = parsed.entries.find((e) => e.line === line)!;
    expect(added.title).toBe('Mara is born');
    expect(added.eraIndex).toBe(0);
    expect(parsed.entries.map((e) => e.title)).toEqual(['The Salt Charter is sealed', 'Mara is born', 'The blackout', 'The First Keeper', "The Grey Pilot's crossing"]);

    const later = insertChronicleEntry(TEXT, { ...draft, date: { start: { year: 322, month: 2 }, end: null }, title: 'Gales' }, CAL);
    const titles = parseChronicle(later.text, CAL).entries.filter((e) => e.eraIndex === 1).map((e) => e.title);
    expect(titles[0]).toBe('Gales');
  });

  it('inserts into a file without eras', () => {
    const { text } = insertChronicleEntry('', { date: { start: { year: 5 }, end: null }, title: 'First', kind: 'event', where: [], with: [], books: [], body: '' }, CAL);
    expect(text).toBe('\n## 5 · First\n');
    const second = insertChronicleEntry(text, { date: { start: { year: 2 }, end: null }, title: 'Zeroth', kind: 'event', where: [], with: [], books: [], body: '' }, CAL);
    expect(parseChronicle(second.text, CAL).entries.map((e) => e.title)).toEqual(['Zeroth', 'First']);
  });

  it('replaces an entry in place, keeping surrounding text', () => {
    const { text } = replaceChronicleEntry(TEXT, 14, { date: { start: { year: 322, month: 3 }, end: null }, title: 'The great blackout', kind: 'event', where: [], with: ['Mara Vell'], books: [], body: 'Dark.' }, CAL);
    expect(text).toContain('## 322-03 · The great blackout\nWith: [[Mara Vell]]\n\nDark.\n\n## c. 1 - The First Keeper');
    expect(text).toContain('From: 322');
  });

  it('moves an entry whose date changed', () => {
    const { text } = replaceChronicleEntry(TEXT, 14, { date: { start: { year: 241 }, end: null }, title: 'The blackout', kind: 'event', where: [], with: [], books: [], body: '' }, CAL);
    const parsed = parseChronicle(text, CAL);
    expect(parsed.entries.find((e) => e.title === 'The blackout')!.eraIndex).toBe(0);
  });

  it('removes an entry', () => {
    const text = removeChronicleEntry(TEXT, 6, CAL);
    expect(text).not.toContain('Salt Charter');
    expect(parseChronicle(text, CAL).eras[0].description).toBe('Salt for passage.');
  });
});
