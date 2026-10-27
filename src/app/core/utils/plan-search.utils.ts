import { ParsedBookPlan, PlanHeading, PlanMarker, PlanPov } from '../interfaces/book-plan.interface';
import { flattenOutline } from './book-plan.utils';

/** Characters that `@name` filters can refer to. */
export interface PlanSearchCharacter {
  id: string;
  name: string;
  aliases?: string[];
}

export interface PlanSearchItem {
  kind: 'heading' | 'line';
  /** 0-based line in the plan file. */
  line: number;
  text: string;
  markers: PlanMarker[];
  /** [from, to) ranges of `text` to highlight. */
  highlights: Array<[number, number]>;
}

export interface PlanSearchGroup {
  /** Chapter or section the items belong to. */
  title: string;
  code?: string;
  pov: PlanPov[];
  items: PlanSearchItem[];
}

export const PLAN_SEARCH_MARKERS: readonly PlanMarker[] = ['todo', 'ojo', 'oculto', 'relectura', 'lugar', 'objetivo'];

interface ParsedQuery {
  words: string[];
  codes: string[];
  /** One entry per `!` term: the markers any of which must be present. */
  markerSets: PlanMarker[][];
  /** One entry per `@` term: the name forms (normalized) any of which must appear. */
  people: string[][];
  /** A `!` term matched no marker: nothing can match. */
  unknownMarker: boolean;
}

/** Lowercase and strip accents without changing string length, so match offsets map back to the original. */
export function foldForSearch(text: string): string {
  let out = '';
  for (const ch of text) {
    const folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

/** Name forms a plan may use for a character: full name, first name, aliases. */
function nameForms(character: PlanSearchCharacter): string[] {
  const forms = [character.name, character.name.split(/\s+/)[0], ...(character.aliases ?? [])];
  return [...new Set(forms.map((f) => foldForSearch(f.trim())).filter((f) => f.length >= 2))];
}

export function parsePlanQuery(query: string, characters: PlanSearchCharacter[]): ParsedQuery {
  const parsed: ParsedQuery = { words: [], codes: [], markerSets: [], people: [], unknownMarker: false };
  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const folded = foldForSearch(token);
    if (folded.startsWith('!') && folded.length > 1) {
      const markers = PLAN_SEARCH_MARKERS.filter((m) => m.startsWith(folded.slice(1)));
      // `!o` is ambiguous (ojo, oculto, objetivo): any of them matches.
      if (markers.length) parsed.markerSets.push(markers);
      else parsed.unknownMarker = true;
    } else if (folded.startsWith('@') && folded.length > 1) {
      const term = folded.slice(1);
      const matches = characters.filter((c) => nameForms(c).some((form) => form.startsWith(term)));
      // Unknown names still search as plain text, so characters missing from the project work too.
      parsed.people.push(matches.length ? [...new Set(matches.flatMap(nameForms))] : [term]);
    } else if (/^\d{2,5}$/.test(folded)) {
      parsed.codes.push(folded);
    } else {
      parsed.words.push(folded);
    }
  }
  return parsed;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

/** Ranges where `term` occurs in `folded` (whole-word start when `wordStart`). */
function occurrences(folded: string, term: string, wordStart: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = folded.indexOf(term); i !== -1; i = folded.indexOf(term, i + 1)) {
    if (!wordStart || !isWordChar(folded[i - 1])) out.push([i, i + term.length]);
  }
  return out;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([...range]);
  }
  return out;
}

/** Highlights when `text` matches every word and person term, or null. */
function matchText(text: string, query: ParsedQuery): Array<[number, number]> | null {
  const folded = foldForSearch(text);
  const ranges: Array<[number, number]> = [];
  for (const word of query.words) {
    const found = occurrences(folded, word, false);
    if (!found.length) return null;
    ranges.push(...found);
  }
  for (const forms of query.people) {
    const found = forms.flatMap((form) => occurrences(folded, form, true));
    if (!found.length) return null;
    ranges.push(...found);
  }
  return mergeRanges(ranges);
}

const MAX_RESULTS = 300;

/**
 * Search a parsed plan. Query terms (all must match):
 * - plain words: text contains them (case- and accent-insensitive)
 * - `2180`: inside chapters whose code starts with it
 * - `!todo`, `!ojo`, `!oculto`, `!relectura`, `!lugar`, `!objetivo` (prefixes work): lines with that marker
 * - `@name`: lines mentioning a character (full name, first name or alias)
 * A query with only chapter codes lists matching chapters; headings match plain words in their title.
 */
export function searchPlan(plan: ParsedBookPlan, query: string, characters: PlanSearchCharacter[]): PlanSearchGroup[] {
  const parsed = parsePlanQuery(query, characters);
  if (parsed.unknownMarker) return [];
  const headings = flattenOutline(plan);
  const chapterByCode = new Map(plan.chapters.map((c) => [c.code!, c]));
  const chapterAt = (line: number) => plan.chapters.find((c) => c.line <= line && line < c.endLine);
  const codeOk = (code: string | undefined) =>
    parsed.codes.length === 0 || (!!code && parsed.codes.some((c) => code.startsWith(c)));

  const groups = new Map<PlanHeading | null, PlanSearchGroup>();
  const groupFor = (line: number, code: string | undefined): PlanSearchGroup => {
    const owner =
      (code && chapterByCode.get(code)) ||
      [...headings].reverse().find((h) => h.line <= line && line < h.endLine && h.level <= 2) ||
      null;
    let group = groups.get(owner);
    if (!group) {
      group = { title: owner?.title ?? 'Top', code: owner?.code, pov: owner?.pov ?? [], items: [] };
      groups.set(owner, group);
    }
    return group;
  };

  let count = 0;
  const onlyCodes =
    parsed.codes.length > 0 && !parsed.words.length && !parsed.markerSets.length && !parsed.people.length;
  const empty = !query.trim();

  if (empty || onlyCodes) {
    for (const heading of plan.chapters) {
      if (!codeOk(heading.code)) continue;
      groupFor(heading.line, heading.code).items.push({
        kind: 'heading',
        line: heading.line,
        text: heading.heading,
        markers: [],
        highlights: [],
      });
    }
    return [...groups.values()];
  }

  if (!parsed.markerSets.length && !parsed.people.length) {
    for (const heading of headings) {
      const code = heading.kind === 'section' ? undefined : chapterAt(heading.line)?.code;
      if (!codeOk(code)) continue;
      const highlights = matchText(heading.heading, parsed);
      if (!highlights) continue;
      groupFor(heading.line, code).items.push({
        kind: 'heading',
        line: heading.line,
        text: heading.heading,
        markers: [],
        highlights,
      });
      count++;
    }
  }

  for (const line of plan.lines) {
    if (count >= MAX_RESULTS) break;
    if (!codeOk(line.chapterCode)) continue;
    if (parsed.markerSets.some((set) => !set.some((m) => line.markers.includes(m)))) continue;
    const highlights = matchText(line.text, parsed);
    if (!highlights) continue;
    groupFor(line.line, line.chapterCode).items.push({
      kind: 'line',
      line: line.line,
      text: line.text,
      markers: line.markers,
      highlights,
    });
    count++;
  }

  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort((a, b) => a.line - b.line) }))
    .sort((a, b) => a.items[0].line - b.items[0].line);
}
