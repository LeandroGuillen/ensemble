import { Character } from '../interfaces/character.interface';
import { House } from '../interfaces/house.interface';
import { Book } from '../interfaces/project.interface';
import { parseBookPlan } from './book-plan.utils';
import { parseChronicle } from './chronicle-file.utils';
import { LinkResolver, buildLifelines, buildStoryChapters, buildTimelineItems, continuityIssues } from './timeline.utils';
import { ResolvedWikiLink } from './wiki-links.utils';
import { DEFAULT_CALENDAR } from './world-date.utils';

const CAL = DEFAULT_CALENDAR;
const RECORDS: Record<string, { route: string; id: string }> = {
  'mara vell': { route: 'character', id: 'mara' },
  'ilse dunmore': { route: 'character', id: 'ilse' },
  'joren hale': { route: 'character', id: 'joren' },
  'port saltmere': { route: 'location', id: 'saltmere' },
  'the drowned reach': { route: 'location', id: 'reach' },
};
const resolve: LinkResolver = (target) => {
  const record = RECORDS[target.toLowerCase()];
  return (record ? { state: 'resolved', ...record, title: target } : { state: 'missing', route: 'character', title: target }) as ResolvedWikiLink;
};

function character(id: string, name: string, extra: Partial<Character> = {}): Character {
  return { id, name, category: 'main', tags: [], books: [], prompts: [], content: '', created: new Date(), modified: new Date(), relativePath: id, filePath: id, ...extra };
}

const PLAN = [
  '## 01 - Gate',                   // 0
  'PoV: ilse Ilse Dunmore',         // 1
  'When: 330-03-08 → 330-03-12',    // 2
  '- Lugar: [[Port Saltmere]]',     // 3
  '## 02 - Reef',                   // 4
  'PoV: wren Wren',                 // 5
  'When: 330-03-09',                // 6
  '- Lugar: [[The Drowned Reach]]', // 7
  'Ilse follows [[Joren Hale]] and [[Ilse Dunmore]].', // 8
  '## 03 - Earlier',                // 9
  'PoV: ilse Ilse Dunmore',         // 10
  'When: 330-03-01',                // 11
  '## 04 - Later',                  // 12
  'When: someday',                  // 13
  '## 05 - Undated',                // 14
].join('\n');

describe('timeline.utils', () => {
  it('builds story chapters with dates, places and people', () => {
    const chapters = buildStoryChapters('b2', parseBookPlan(PLAN), CAL, resolve);
    expect(chapters.map((c) => c.code)).toEqual(['01', '02', '03', '04', '05']);
    expect(chapters[0]).toEqual(jasmine.objectContaining({ place: 'saltmere', pov: ['ilse'], whenText: '330-03-08 → 330-03-12' }));
    expect(chapters[1].people.sort()).toEqual(['ilse', 'joren', 'wren']);
    expect(chapters[1].placeLabel).toBe('The Drowned Reach');
    expect(chapters[3].invalid).toBeTrue();
    expect(chapters[4].range).toBeNull();
  });

  it('finds conflicts, flashbacks, lifespan problems and missing dates', () => {
    const chapters = buildStoryChapters('b2', parseBookPlan(PLAN), CAL, resolve);
    const people = new Map([['ilse', { born: '331' }]]);
    const issues = continuityIssues(chapters, people, CAL);
    const types = issues.map((i) => i.type);
    expect(types.filter((t) => t === 'conflict').length).toBe(1);
    const conflict = issues.find((i) => i.type === 'conflict')!;
    expect(conflict.type === 'conflict' && conflict.personId).toBe('ilse');
    expect(types).toContain('flashback');
    expect(types).toContain('lifespan');
    expect(types).toContain('invalid');
    expect(types).toContain('undated');
  });

  it('merges chronicle entries with derived births, reigns and book spans', () => {
    const chronicle = parseChronicle('# Dark\n\n## 322-03 · Blackout\nWith: [[Mara Vell]], [[Nobody]]\nWhere: [[Port Saltmere]]\n', CAL);
    const house = { id: 'vell', name: 'House Vell', seatId: 'light', characterIds: ['mara'], leadership: [{ id: 'r1', characterIds: ['mara'], period: 'Keeper', from: '318', to: '322-03', books: [], notes: '' }] } as unknown as House;
    const book = { id: 'b2', name: 'Tidebreak', color: '#000' } as Book;
    const items = buildTimelineItems({
      calendar: CAL,
      chronicle,
      characters: [character('mara', 'Mara Vell', { born: '301' }), character('old', 'Old', { born: '200', died: '250' })],
      houses: [house],
      books: [book],
      plans: new Map([['b2', parseBookPlan(PLAN)]]),
      resolve,
    });
    expect(items.map((i) => i.kind)).toEqual(['birth', 'death', 'birth', 'reign', 'event', 'book']);
    const blackout = items.find((i) => i.kind === 'event')!;
    expect(blackout.people).toEqual(['mara']);
    expect(blackout.places).toEqual(['saltmere']);
    expect(blackout.unresolved).toEqual(['Nobody']);
    const bookItem = items.find((i) => i.kind === 'book')!;
    expect(bookItem.date).toEqual({ start: { year: 330, month: 3, day: 1 }, end: { year: 330, month: 3, day: 12 } });
  });

  it('builds lifelines with residence segments and reigns', () => {
    const mara = character('mara', 'Mara Vell', {
      born: '300',
      residence: [{ from: '300', place: 'light' }, { from: '310', place: 'reach', note: 'lost' }],
    });
    const house = { id: 'vell', name: 'Vell', characterIds: [], leadership: [{ id: 'r', characterIds: ['mara'], period: 'Keeper', from: '318', books: [], notes: '' }] } as unknown as House;
    const { lines, undated } = buildLifelines([mara, character('x', 'No dates')], [house], CAL, 330);
    expect(undated.map((c) => c.id)).toEqual(['x']);
    const [line] = lines;
    expect(line.houses).toEqual(['vell']);
    expect(line.segments.map((s) => [s.from, s.to, s.place, s.note ?? null])).toEqual([[300, 310, 'light', null], [310, 330, 'reach', 'lost']]);
    expect(line.reigns).toEqual([{ houseId: 'vell', from: 318, to: null, label: 'Keeper' }]);
  });
});
