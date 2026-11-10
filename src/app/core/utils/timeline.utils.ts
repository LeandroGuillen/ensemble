import { ParsedBookPlan } from '../interfaces/book-plan.interface';
import { Character } from '../interfaces/character.interface';
import { House } from '../interfaces/house.interface';
import { Book } from '../interfaces/project.interface';
import { ChronicleEntry, ParsedChronicle, eraStarts } from './chronicle-file.utils';
import { ResolvedWikiLink } from './wiki-links.utils';
import {
  DayRange,
  WorldCalendar,
  WorldDate,
  WorldSpan,
  dateFromDay,
  dateToYear,
  dayNumber,
  parseWorldDate,
  parseWorldSpan,
  spanDays,
} from './world-date.utils';

/** Resolves a `[[target]]` to a record (characters, locations, Houses). */
export type LinkResolver = (target: string) => ResolvedWikiLink;

export type TimelineItemKind = 'event' | 'legend' | 'birth' | 'death' | 'reign' | 'book';

/** One row of the Chronicle: an authored entry or one derived from other records. */
export interface TimelineItem {
  key: string;
  kind: TimelineItemKind;
  title: string;
  date: WorldSpan | null;
  range: DayRange | null;
  /** Date text was written but could not be read. */
  dateInvalid?: boolean;
  people: string[];
  places: string[];
  houses: string[];
  /** Link targets that don't resolve to a record. */
  unresolved: string[];
  books: string[];
  body: string;
  /** Authored entries: heading line in the chronicle file. */
  entryLine?: number;
  /** Derived entries: where the data comes from. */
  derivedFrom?: { label: string; route: unknown[]; queryParams?: Record<string, string> };
  /** Era index in the chronicle (authored by position, derived by date). */
  eraIndex: number;
}

export interface TimelineInputs {
  calendar: WorldCalendar;
  chronicle: ParsedChronicle | null;
  characters: Character[];
  houses: House[];
  books: Book[];
  /** Parsed plan per book id (books with a plan file). */
  plans: ReadonlyMap<string, ParsedBookPlan>;
  resolve: LinkResolver;
}

function resolveTargets(targets: string[], resolve: LinkResolver) {
  const people: string[] = [];
  const places: string[] = [];
  const houses: string[] = [];
  const unresolved: string[] = [];
  for (const target of targets) {
    const link = resolve(target);
    if (link.state !== 'resolved' || !link.id) unresolved.push(target);
    else if (link.route === 'character' || link.route === 'character-draft') people.push(link.id);
    else if (link.route === 'location') places.push(link.id);
    else if (link.route === 'house') houses.push(link.id);
    else unresolved.push(target);
  }
  return { people: unique(people), places: unique(places), houses: unique(houses), unresolved };
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function chronicleItem(entry: ChronicleEntry, calendar: WorldCalendar, resolve: LinkResolver): TimelineItem {
  const linked = resolveTargets([...entry.where, ...entry.with], resolve);
  return {
    key: `entry:${entry.line}`,
    kind: entry.kind,
    title: entry.title,
    date: entry.date,
    range: entry.date ? spanDays(entry.date, calendar) : null,
    dateInvalid: entry.dateInvalid,
    people: linked.people,
    places: linked.places,
    houses: linked.houses,
    unresolved: linked.unresolved,
    books: entry.books,
    body: entry.body,
    entryLine: entry.line,
    eraIndex: entry.eraIndex,
  };
}

/** Story-time span of each book: from its earliest to its latest dated chapter. */
export function bookSpans(inputs: Pick<TimelineInputs, 'books' | 'plans' | 'calendar'>): Map<string, DayRange> {
  const spans = new Map<string, DayRange>();
  for (const book of inputs.books) {
    const plan = inputs.plans.get(book.id);
    if (!plan) continue;
    let start = Infinity;
    let end = -Infinity;
    for (const chapter of plan.chapters) {
      const span = chapter.when ? parseWorldSpan(chapter.when.text, inputs.calendar) : null;
      if (!span) continue;
      const range = spanDays(span, inputs.calendar);
      start = Math.min(start, range.start);
      end = Math.max(end, range.end);
    }
    if (Number.isFinite(start)) spans.set(book.id, { start, end });
  }
  return spans;
}

function lifeDate(text: string | undefined, calendar: WorldCalendar): WorldDate | null {
  return text ? parseWorldDate(text, calendar) : null;
}

/**
 * All Chronicle rows: authored entries plus births and deaths (character `born:`/`died:`),
 * House reigns (`from:`/`to:`) and book spans (chapter `When:` lines).
 */
export function buildTimelineItems(inputs: TimelineInputs): TimelineItem[] {
  const { calendar, chronicle, resolve } = inputs;
  const items: TimelineItem[] = (chronicle?.entries ?? []).map((entry) => chronicleItem(entry, calendar, resolve));
  const starts = chronicle ? eraStarts(chronicle, calendar) : [];
  const eraFor = (range: DayRange | null): number => {
    if (!chronicle?.eras.length) return -1;
    if (!range) return chronicle.eras.length - 1;
    let found = 0;
    starts.forEach((start, i) => {
      if (start !== null && start <= range.start) found = i;
    });
    return found;
  };
  const derived = (item: Omit<TimelineItem, 'eraIndex' | 'range' | 'unresolved' | 'body' | 'houses'> & Partial<TimelineItem>) => {
    const range = item.date ? spanDays(item.date, calendar) : null;
    items.push({ unresolved: [], body: '', houses: [], ...item, range, eraIndex: eraFor(range) });
  };

  for (const character of inputs.characters) {
    const born = lifeDate(character.born, calendar);
    const died = lifeDate(character.died, calendar);
    const route = ['/character', character.id];
    if (born) {
      derived({ key: `born:${character.id}`, kind: 'birth', title: `${character.name} is born`, date: { start: born, end: null }, people: [character.id], places: [], books: [], derivedFrom: { label: `${character.name} · born`, route } });
    }
    if (died) {
      derived({ key: `died:${character.id}`, kind: 'death', title: `${character.name} dies`, date: { start: died, end: null }, people: [character.id], places: [], books: [], derivedFrom: { label: `${character.name} · died`, route } });
    }
  }

  for (const house of inputs.houses) {
    for (const reign of house.leadership) {
      const from = lifeDate(reign.from, calendar);
      if (!from) continue;
      const to = lifeDate(reign.to, calendar);
      const validEnd = to && dayNumber(to, calendar, 'end') >= dayNumber(from, calendar, 'start') ? to : null;
      derived({
        key: `reign:${house.id}:${reign.id}`,
        kind: 'reign',
        title: `${house.name}${reign.period ? ` · ${reign.period}` : ''}`,
        date: { start: from, end: validEnd },
        people: reign.characterIds,
        places: house.seatId ? [house.seatId] : [],
        houses: [house.id],
        books: reign.books,
        body: reign.notes,
        derivedFrom: { label: `${house.name} · reigns`, route: ['/house', house.id] },
      });
    }
  }

  const spans = bookSpans(inputs);
  for (const book of inputs.books) {
    const range = spans.get(book.id);
    if (!range) continue;
    const start = dateFromDay(range.start, calendar);
    const end = dateFromDay(range.end, calendar);
    derived({
      key: `book:${book.id}`,
      kind: 'book',
      title: book.name,
      date: { start, end: range.end > range.start ? end : null },
      people: book.povCharacterIds ?? [],
      places: [],
      books: [book.id],
      derivedFrom: { label: `${book.name} · chapter dates`, route: ['/book', book.id], queryParams: { view: 'timeline' } },
    });
  }

  return items.sort(compareItems);
}

/** Date order; undated last; derived rows after authored ones on the same day. */
export function compareItems(a: TimelineItem, b: TimelineItem): number {
  const da = a.range?.start ?? Infinity;
  const db = b.range?.start ?? Infinity;
  if (da !== db) return da < db ? -1 : 1;
  const authored = (item: TimelineItem) => (item.entryLine !== undefined ? 0 : 1);
  if (authored(a) !== authored(b)) return authored(a) - authored(b);
  return (a.entryLine ?? 0) - (b.entryLine ?? 0) || a.title.localeCompare(b.title);
}

// ---------------------------------------------------------------- story time

export interface StoryChapter {
  key: string;
  bookId: string;
  code: string;
  title: string;
  /** 0-based heading line in the plan. */
  line: number;
  /** Reading order within the book. */
  order: number;
  whenText: string;
  date: WorldSpan | null;
  /** `When:` text that can't be read. */
  invalid: boolean;
  range: DayRange | null;
  /** PoV character ids. */
  pov: string[];
  /** Location id from the chapter's `Lugar:` line, when it links one. */
  place: string | null;
  /** Place as written, for unlinked `Lugar:` text. */
  placeLabel: string | null;
  /** PoV plus characters linked anywhere in the chapter. */
  people: string[];
}

const LUGAR_RE = /^\s*(?:[-*+]\s+)?Lugar:\s*(.*)$/i;
const LINK_RE = /(?<!!)\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|([^\[\]\n]*))?\]\]/g;

/** Wikilinks in one plan line (a light regex: plans are re-read on every edit). */
function lineLinks(text: string): { target: string; label: string }[] {
  return [...text.matchAll(LINK_RE)].map((m) => ({ target: m[1].trim(), label: m[2]?.trim() || m[1].trim() }));
}

export function buildStoryChapters(
  bookId: string,
  plan: ParsedBookPlan,
  calendar: WorldCalendar,
  resolve: LinkResolver
): StoryChapter[] {
  return plan.chapters.map((chapter, order) => {
    const whenText = chapter.when?.text ?? '';
    const span = whenText ? parseWorldSpan(whenText, calendar) : null;
    const lines = plan.lines.filter((line) => line.line > chapter.line && line.line < chapter.endLine);
    let place: string | null = null;
    let placeLabel: string | null = null;
    const people = new Set(chapter.pov.map((pov) => pov.characterId));
    for (const line of lines) {
      const links = lineLinks(line.text);
      const lugar: RegExpExecArray | null = !place && !placeLabel && line.markers.includes('lugar') ? LUGAR_RE.exec(line.text) : null;
      if (lugar) {
        const link = links[0] ? resolve(links[0].target) : null;
        if (link?.state === 'resolved' && link.route === 'location' && link.id) place = link.id;
        placeLabel = links[0]?.label || lugar[1].trim() || null;
      }
      for (const link of links) {
        const resolved = resolve(link.target);
        if (resolved.state === 'resolved' && resolved.route === 'character' && resolved.id) people.add(resolved.id);
      }
    }
    return {
      key: `${bookId}:${chapter.line}`,
      bookId,
      code: chapter.code ?? '',
      title: chapter.title,
      line: chapter.line,
      order,
      whenText,
      date: span ?? null,
      invalid: span === undefined,
      range: span ? spanDays(span, calendar) : null,
      pov: chapter.pov.map((pov) => pov.characterId),
      place,
      placeLabel,
      people: [...people],
    };
  });
}

export type ContinuityIssue =
  | { type: 'conflict'; personId: string; a: StoryChapter; b: StoryChapter }
  | { type: 'flashback'; chapter: StoryChapter; back: number }
  | { type: 'lifespan'; chapter: StoryChapter; personId: string; reason: 'unborn' | 'dead' }
  | { type: 'undated'; chapter: StoryChapter }
  | { type: 'invalid'; chapter: StoryChapter };

/**
 * Continuity checks over chapters in reading order: someone in two places at once,
 * chapters that step back in time, people who aren't alive yet (or anymore), missing dates.
 */
export function continuityIssues(
  chapters: StoryChapter[],
  people: ReadonlyMap<string, Pick<Character, 'born' | 'died'>>,
  calendar: WorldCalendar
): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const dated = chapters.filter((c) => c.range);
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      const placeA = a.place ?? a.placeLabel?.toLowerCase() ?? null;
      const placeB = b.place ?? b.placeLabel?.toLowerCase() ?? null;
      if (!placeA || !placeB || placeA === placeB) continue;
      if (a.range!.start > b.range!.end || b.range!.start > a.range!.end) continue;
      for (const person of a.people) {
        if (b.people.includes(person)) issues.push({ type: 'conflict', personId: person, a, b });
      }
    }
  }
  const latestByBook = new Map<string, number>();
  for (const chapter of chapters) {
    if (!chapter.range) continue;
    const latest = latestByBook.get(chapter.bookId);
    if (latest !== undefined && chapter.range.start < latest) {
      issues.push({ type: 'flashback', chapter, back: latest - chapter.range.start });
    }
    latestByBook.set(chapter.bookId, Math.max(latest ?? -Infinity, chapter.range.start));
  }
  for (const chapter of dated) {
    for (const personId of chapter.pov) {
      const person = people.get(personId);
      const born = person?.born ? parseWorldDate(person.born, calendar) : null;
      const died = person?.died ? parseWorldDate(person.died, calendar) : null;
      if (born && chapter.range!.end < dayNumber(born, calendar, 'start')) {
        issues.push({ type: 'lifespan', chapter, personId, reason: 'unborn' });
      } else if (died && chapter.range!.start > dayNumber(died, calendar, 'end')) {
        issues.push({ type: 'lifespan', chapter, personId, reason: 'dead' });
      }
    }
  }
  for (const chapter of chapters) {
    if (chapter.invalid) issues.push({ type: 'invalid', chapter });
    else if (!chapter.range) issues.push({ type: 'undated', chapter });
  }
  return issues;
}

// ---------------------------------------------------------------- lifelines

export interface LifelineSegment {
  /** Decimal years. */
  from: number;
  to: number;
  place: string | null;
  note?: string;
}

export interface LifelineReign {
  houseId: string;
  from: number;
  to: number | null;
  label: string;
}

export interface Lifeline {
  id: string;
  name: string;
  lore: boolean;
  /** Decimal years; null when unknown. */
  born: number | null;
  died: number | null;
  bornDate: WorldDate | null;
  diedDate: WorldDate | null;
  /** Houses the character belongs to (members or heads), in House order. */
  houses: string[];
  segments: LifelineSegment[];
  reigns: LifelineReign[];
}

/** Lifelines for characters with a birth date; `now` closes open-ended lines. */
export function buildLifelines(
  characters: Character[],
  houses: House[],
  calendar: WorldCalendar,
  now: number
): { lines: Lifeline[]; undated: Character[] } {
  const lines: Lifeline[] = [];
  const undated: Character[] = [];
  for (const character of characters) {
    const bornDate = lifeDate(character.born, calendar);
    if (!bornDate) {
      undated.push(character);
      continue;
    }
    const diedDate = lifeDate(character.died, calendar);
    const born = dateToYear(bornDate, calendar, 'start');
    const died = diedDate ? dateToYear(diedDate, calendar, 'end') : null;
    const end = died ?? now;
    const rows = (character.residence ?? [])
      .map((row) => ({ row, date: parseWorldDate(row.from, calendar) }))
      .filter((r): r is { row: typeof r.row; date: WorldDate } => !!r.date)
      .map((r) => ({ ...r.row, at: dateToYear(r.date, calendar, 'start') }))
      .sort((a, b) => a.at - b.at);
    const segments: LifelineSegment[] = [];
    let cursor = born;
    for (let i = 0; i <= rows.length; i++) {
      const next = rows[i];
      const until = Math.min(next ? Math.max(next.at, born) : end, end);
      const previous = rows[i - 1];
      if (until > cursor || (!next && segments.length === 0)) {
        segments.push({ from: cursor, to: Math.max(until, cursor), place: previous?.place ?? null, ...(previous?.note ? { note: previous.note } : {}) });
      }
      cursor = Math.max(cursor, until);
    }
    const memberOf = houses
      .filter((house) => house.characterIds.includes(character.id) || house.leadership.some((r) => r.characterIds.includes(character.id)))
      .map((house) => house.id);
    const reigns: LifelineReign[] = [];
    for (const house of houses) {
      for (const reign of house.leadership) {
        if (!reign.characterIds.includes(character.id)) continue;
        const from = lifeDate(reign.from, calendar);
        if (!from) continue;
        const to = lifeDate(reign.to, calendar);
        reigns.push({
          houseId: house.id,
          from: dateToYear(from, calendar, 'start'),
          to: to ? dateToYear(to, calendar, 'end') : null,
          label: reign.period,
        });
      }
    }
    lines.push({ id: character.id, name: character.name, lore: !!character.lore, born, died, bornDate, diedDate, houses: memberOf, segments, reigns });
  }
  return { lines: lines.sort((a, b) => a.born! - b.born! || a.name.localeCompare(b.name)), undated };
}
