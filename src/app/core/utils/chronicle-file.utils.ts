import { WorldCalendar, WorldSpan, parseWorldSpan, serializeWorldSpan, spanDays } from './world-date.utils';

/**
 * The chronicle: a Markdown file of dated world events (default `chronicle.md`).
 *
 * ```markdown
 * # The Dark Harbor            ← era; text below it is the era's description
 * From: 322                    ← optional era start (otherwise its earliest entry)
 *
 * ## 322-03 · The blackout     ← entry: `<date or span> · <title>` (` - ` also works)
 * Where: [[Vellhaven Lighthouse]]
 * With: [[Mara Vell]], [[Saffi Reed]]
 * Book: lc1
 * Kind: legend                 ← optional; entries are events by default
 *
 * Free Markdown body…
 *
 * ## The Grey Pilot's crossing ← a heading without a date is an undated entry
 * ```
 *
 * Edits rewrite only the lines of the entry they touch, so the rest of the file keeps
 * its formatting.
 */

export type ChronicleKind = 'event' | 'legend';

export interface ChronicleEra {
  title: string;
  /** Description text below the heading (property lines excluded). */
  description: string;
  /** Explicit start from a `From:` line. */
  from: WorldSpan | null;
  /** 0-based heading line and end line (exclusive). */
  line: number;
  endLine: number;
}

export interface ChronicleEntry {
  /** Stable for one parse: the heading's 0-based line. */
  line: number;
  /** End line (exclusive): next heading of level ≤ 2, or EOF. */
  endLine: number;
  heading: string;
  /** Date text as written (empty when undated). */
  dateText: string;
  /** Parsed date; null when undated or unreadable (see `dateInvalid`). */
  date: WorldSpan | null;
  dateInvalid: boolean;
  title: string;
  kind: ChronicleKind;
  /** Wikilink targets from `Where:`. */
  where: string[];
  /** Wikilink targets from `With:`. */
  with: string[];
  /** Book ids from `Book:` / `Books:`. */
  books: string[];
  body: string;
  /** Index in `eras`, or -1 before the first era heading. */
  eraIndex: number;
}

export interface ParsedChronicle {
  /** Frontmatter keys (string values only). */
  frontmatter: Record<string, string>;
  eras: ChronicleEra[];
  entries: ChronicleEntry[];
}

/** What an editor provides to create or replace an entry. */
export interface ChronicleEntryDraft {
  date: WorldSpan | null;
  title: string;
  kind: ChronicleKind;
  where: string[];
  with: string[];
  books: string[];
  body: string;
}

// Markdown closing hashes require preceding whitespace (C# is part of a title).
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const PROPERTY_RE = /^(Where|With|Books?|Kind|Type|From):\s*(.*)$/i;
const BODY_HEADING_RE = /^(\\*)(#{1,6}\s)/;
const BODY_PROPERTY_RE = /^([ \t]*(?:Where|With|Books?|Kind|Type|From))(\\*):/i;
const FENCE_RE = /^\s*(```|~~~)/;
/** `<date or span>` then ` · `, ` - `, ` – ` or ` — `, then the title. */
const DATED_HEADING_RE = /^((?:c\.\s*|~\s*)?-?\d{1,6}(?:-\d{1,3}){0,2}(?:\s*(?:→|->|\.\.)\s*(?:c\.\s*|~\s*)?-?\d{1,6}(?:-\d{1,3}){0,2})?)\s+[·\-–—]\s+(.+)$/i;
const UNDATED_HEADING_RE = /^\?\s+[·\-–—]\s+(.+)$/;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Wikilink targets in a property value; plain comma-separated names when there are no links. */
export function propertyTargets(value: string): string[] {
  const links = [...value.matchAll(WIKILINK_RE)].map((m) => m[1].trim()).filter(Boolean);
  if (links.length) return links;
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

export function parseChronicle(text: string, calendar: WorldCalendar): ParsedChronicle {
  const lines = text.split('\n');
  const frontmatter: Record<string, string> = {};
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (match) frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
      }
      start = end + 1;
    }
  }

  const eras: ChronicleEra[] = [];
  const entries: ChronicleEntry[] = [];
  let era: ChronicleEra | null = null;
  let entry: ChronicleEntry | null = null;
  let bodyLines: string[] = [];
  let eraLines: string[] = [];
  /** Property lines are only read directly below a heading (blank lines allowed). */
  let readingProps = false;
  let inFence = false;

  const closeEntry = (endLine: number) => {
    if (!entry) return;
    entry.endLine = endLine;
    entry.body = trimBlankLines(bodyLines).join('\n');
    entries.push(entry);
    entry = null;
    bodyLines = [];
  };
  const closeEra = (endLine: number) => {
    if (!era) return;
    era.endLine = endLine;
    // Text after the era's first entry belongs to entries; only an entry-less era sets it here.
    if (eraLines.length) era.description = trimBlankLines(eraLines).join('\n');
    era = null;
    eraLines = [];
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (FENCE_RE.test(raw)) inFence = !inFence;
    const heading = inFence ? null : HEADING_RE.exec(raw);
    const level = heading ? heading[1].length : 0;

    if (heading && level === 1) {
      closeEntry(i);
      closeEra(i);
      era = { title: heading[2], description: '', from: null, line: i, endLine: lines.length };
      eras.push(era);
      readingProps = true;
      continue;
    }
    if (heading && level === 2) {
      closeEntry(i);
      if (era) {
        // The era's own text ends at its first entry.
        era.description = trimBlankLines(eraLines).join('\n');
        eraLines = [];
      }
      entry = parseEntryHeading(heading[2], i, eras.length - 1, calendar);
      readingProps = true;
      continue;
    }

    const trimmed = raw.trim();
    if (readingProps && !inFence) {
      if (!trimmed) continue;
      const prop = PROPERTY_RE.exec(trimmed);
      if (prop) {
        applyProperty(prop[1].toLowerCase(), prop[2], entry, entry ? null : era, calendar);
        continue;
      }
      readingProps = false;
    }
    if (entry) bodyLines.push(inFence ? raw : decodeBodyLine(raw));
    else if (era) eraLines.push(raw);
  }
  closeEntry(lines.length);
  if (era) {
    (era as ChronicleEra).endLine = lines.length;
    if (eraLines.length) (era as ChronicleEra).description = trimBlankLines(eraLines).join('\n');
  }

  return { frontmatter, eras, entries };
}

function parseEntryHeading(text: string, line: number, eraIndex: number, calendar: WorldCalendar): ChronicleEntry {
  // The writer escapes hashes and backslashes in titles, using Markdown escapes.
  const decodeTitle = (title: string) => title.replace(/\\([\\#])/g, '$1');
  const base: ChronicleEntry = {
    line,
    endLine: line + 1,
    heading: text,
    dateText: '',
    date: null,
    dateInvalid: false,
    title: decodeTitle(text),
    kind: 'event',
    where: [],
    with: [],
    books: [],
    body: '',
    eraIndex,
  };
  const undated = UNDATED_HEADING_RE.exec(text);
  if (undated) return { ...base, title: decodeTitle(undated[1].trim()) };
  const dated = DATED_HEADING_RE.exec(text);
  if (!dated) return base;
  const span = parseWorldSpan(dated[1], calendar);
  return {
    ...base,
    dateText: dated[1].trim(),
    date: span ?? null,
    dateInvalid: span === undefined,
    title: decodeTitle(dated[2].trim()),
  };
}

function applyProperty(
  key: string,
  value: string,
  entry: ChronicleEntry | null,
  era: ChronicleEra | null,
  calendar: WorldCalendar
): void {
  if (era && key === 'from') {
    era.from = parseWorldSpan(value, calendar) ?? null;
    return;
  }
  if (!entry) return;
  if (key === 'where') entry.where.push(...propertyTargets(value));
  else if (key === 'with') entry.with.push(...propertyTargets(value));
  else if (key === 'book' || key === 'books') entry.books.push(...value.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean));
  else if (key === 'kind' || key === 'type') entry.kind = /legend|myth/i.test(value) ? 'legend' : 'event';
}

function trimBlankLines(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

const link = (target: string) => `[[${target}]]`;

/** Protect body syntax without changing how legacy, unescaped properties are read. */
function encodeBody(body: string): string {
  let inFence = false;
  return body.split('\n').map((line) => {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (inFence) return line;
    return line
      .replace(BODY_HEADING_RE, '\\$1$2')
      .replace(BODY_PROPERTY_RE, '$1$2\\:');
  }).join('\n');
}

function decodeBodyLine(line: string): string {
  return line
    .replace(/^\\(\\*#{1,6}\s)/, '$1')
    .replace(/^([ \t]*(?:Where|With|Books?|Kind|Type|From))\\(\\*):/i, '$1$2:');
}

/** Markdown for one entry, ending with a newline. */
export function formatChronicleEntry(draft: ChronicleEntryDraft): string {
  const title = (draft.title.trim() || 'Untitled').replace(/[\\#]/g, '\\$&');
  const head = draft.date ? `## ${serializeWorldSpan(draft.date)} · ${title}` : `## ? · ${title}`;
  const props = [
    draft.where.length ? `Where: ${draft.where.map(link).join(', ')}` : '',
    draft.with.length ? `With: ${draft.with.map(link).join(', ')}` : '',
    draft.books.length ? `${draft.books.length > 1 ? 'Books' : 'Book'}: ${draft.books.join(', ')}` : '',
    draft.kind === 'legend' ? 'Kind: legend' : '',
  ].filter(Boolean);
  const body = encodeBody(trimBlankLines(draft.body.split('\n')).join('\n'));
  return [head, ...props, ...(body ? ['', body] : [])].join('\n') + '\n';
}

/** Sort key of an entry date; undated entries sort last. */
function sortDay(span: WorldSpan | null, calendar: WorldCalendar): number {
  return span ? spanDays(span, calendar).start : Number.POSITIVE_INFINITY;
}

/** The era an entry belongs in by date: the last era starting on or before it. */
export function eraIndexForDate(parsed: ParsedChronicle, span: WorldSpan | null, calendar: WorldCalendar): number {
  if (!span || !parsed.eras.length) return parsed.eras.length ? parsed.eras.length - 1 : -1;
  const day = spanDays(span, calendar).start;
  const starts = eraStarts(parsed, calendar);
  let found = 0;
  starts.forEach((s, i) => {
    if (s !== null && s <= day) found = i;
  });
  return found;
}

/** Start day of each era: its `From:` line, or its earliest dated entry. */
export function eraStarts(parsed: ParsedChronicle, calendar: WorldCalendar): (number | null)[] {
  return parsed.eras.map((era, index) => {
    if (era.from) return spanDays(era.from, calendar).start;
    const days = parsed.entries
      .filter((e) => e.eraIndex === index && e.date)
      .map((e) => spanDays(e.date!, calendar).start);
    return days.length ? Math.min(...days) : null;
  });
}

/**
 * Insert an entry in date order inside its era (or the given era). A file without
 * eras keeps entries in date order at the top level.
 */
export function insertChronicleEntry(
  text: string,
  draft: ChronicleEntryDraft,
  calendar: WorldCalendar,
  eraIndex?: number
): { text: string; line: number } {
  const parsed = parseChronicle(text, calendar);
  const era = eraIndex ?? eraIndexForDate(parsed, draft.date, calendar);
  const day = sortDay(draft.date, calendar);
  const siblings = parsed.entries.filter((e) => e.eraIndex === era);
  const before = siblings.find((e) => sortDay(e.date, calendar) > day);

  const lines = text.split('\n');
  let at: number;
  if (before) {
    at = before.line;
  } else if (siblings.length) {
    at = siblings[siblings.length - 1].endLine;
  } else if (era >= 0 && parsed.eras[era]) {
    at = parsed.eras[era].endLine;
  } else {
    at = parsed.eras.length ? parsed.eras[0].line : lines.length;
  }
  // Never insert before the frontmatter.
  const entryLines = formatChronicleEntry(draft).replace(/\n$/, '').split('\n');
  return spliceBlock(lines, at, at, entryLines);
}

/** Replace an entry (from the latest parse of `text`) with a draft; moves it when its date changed era/order. */
export function replaceChronicleEntry(
  text: string,
  entryLine: number,
  draft: ChronicleEntryDraft,
  calendar: WorldCalendar
): { text: string; line: number } {
  const parsed = parseChronicle(text, calendar);
  const entry = parsed.entries.find((e) => e.line === entryLine);
  if (!entry) return insertChronicleEntry(text, draft, calendar);
  const sameDate = serializeSpanOrNull(entry.date) === serializeSpanOrNull(draft.date) && !entry.dateInvalid;
  if (sameDate) {
    const lines = text.split('\n');
    const entryLines = formatChronicleEntry(draft).replace(/\n$/, '').split('\n');
    return spliceBlock(lines, entry.line, trimTrailingBlank(lines, entry.line, entry.endLine), entryLines);
  }
  const removed = removeChronicleEntry(text, entryLine, calendar);
  return insertChronicleEntry(removed, draft, calendar, entry.eraIndex >= 0 ? undefined : -1);
}

export function removeChronicleEntry(text: string, entryLine: number, calendar: WorldCalendar): string {
  const parsed = parseChronicle(text, calendar);
  const entry = parsed.entries.find((e) => e.line === entryLine);
  if (!entry) return text;
  const lines = text.split('\n');
  lines.splice(entry.line, entry.endLine - entry.line);
  // Collapse the blank lines left behind.
  for (let i = Math.min(entry.line, lines.length - 1); i > 0 && !lines[i]?.trim() && !lines[i - 1]?.trim(); i--) {
    lines.splice(i, 1);
  }
  return lines.join('\n');
}

function serializeSpanOrNull(span: WorldSpan | null): string {
  return span ? serializeWorldSpan(span) : '';
}

function trimTrailingBlank(lines: string[], from: number, to: number): number {
  let end = to;
  while (end > from + 1 && !lines[end - 1]?.trim()) end--;
  return end;
}

/** Replace lines [from, to) with a block, keeping one blank line around it. */
function spliceBlock(lines: string[], from: number, to: number, block: string[]): { text: string; line: number } {
  const out = [...lines];
  const before: string[] = from > 0 && out[from - 1]?.trim() ? [''] : [];
  const after: string[] = to < out.length && out[to]?.trim() ? [''] : [];
  out.splice(from, to - from, ...before, ...block, ...after);
  let text = out.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return { text, line: from + before.length };
}

/** Starter content for a new chronicle file. */
export function newChronicleText(projectName: string): string {
  return `# ${projectName || 'Chronicle'}\n\nEras are \`#\` headings; entries are \`## <date> · <title>\` headings.\n`;
}
