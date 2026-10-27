import {
  ParsedBookPlan,
  PlanHeading,
  PlanLine,
  PlanMarker,
  PlanPov,
} from '../interfaces/book-plan.interface';

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** `2180 - Paseo por Nueva Alascar (D)` → code + rest. */
const CHAPTER_RE = /^(\d{3,5})\s*[-–—]\s*(.*)$/;
const TRAILING_PAREN_RE = /\s*\([^()]*\)\s*$/;
const POV_RE = /^PoV:\s*(\S+)\s*(.*)$/i;

/** The line written for a chapter's point of view. */
export function formatPovLine(characterId: string, name: string): string {
  return `PoV: ${characterId} ${name}`.trimEnd();
}
const FENCE_RE = /^\s*(```|~~~)/;
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
/** Deepest heading level that becomes an outline node; deeper headings are content lines. */
const MAX_OUTLINE_LEVEL = 3;

const MARKER_PATTERNS: ReadonlyArray<[PlanMarker, RegExp]> = [
  ['todo', /\bTODO\b/],
  ['ojo', /\bOJO\b/],
  ['relectura', /\bRE-?LECTURA\b/i],
  ['oculto', /informaci[oó]n oculta/i],
  ['lugar', /^\s*(?:[-*+]\s+)?Lugar:/i],
  ['objetivo', /^\s*(?:[-*+]\s+)?Objetivo(?: principal)?:/i],
];

/** Markers that label a list item whose nested items carry the marker too ("Información oculta aquí:"). */
const INHERITED_MARKERS: ReadonlySet<PlanMarker> = new Set(['oculto']);

export function lineMarkers(text: string): PlanMarker[] {
  return MARKER_PATTERNS.filter(([, re]) => re.test(text)).map(([marker]) => marker);
}

function indentWidth(line: string): number {
  const leading = /^[\t ]*/.exec(line)![0];
  return leading.replace(/\t/g, '    ').length;
}

/**
 * Parse a book plan: `#` sections, `## <code> - <title>` chapters with optional
 * `PoV: <character_id> <name>` lines right below the heading, and `###` scenes.
 * Pure and line-based, so it can run on every keystroke.
 */
export function parseBookPlan(text: string): ParsedBookPlan {
  const rawLines = text.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of rawLines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const offsetAt = (line: number): number => (line < rawLines.length ? lineStarts[line] : text.length);

  const outline: PlanHeading[] = [];
  const chapters: PlanHeading[] = [];
  const lines: PlanLine[] = [];
  const open: PlanHeading[] = [];
  /** Indent of the list item that started an inherited marker, per marker. */
  const inherited = new Map<PlanMarker, number>();

  const close = (until: number, endLine: number): void => {
    while (open.length > 0 && open[open.length - 1].level >= until) {
      const heading = open.pop()!;
      heading.endLine = endLine;
      heading.to = offsetAt(endLine);
    }
  };

  let start = 0;
  if (rawLines[0]?.trim() === '---') {
    const end = rawLines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end > 0) start = end + 1;
  }

  let inFence = false;
  for (let i = start; i < rawLines.length; i++) {
    const raw = rawLines[i];

    if (FENCE_RE.test(raw)) inFence = !inFence;
    const headingMatch = inFence ? null : HEADING_RE.exec(raw);
    const level = headingMatch ? headingMatch[1].length : 0;

    if (headingMatch && level <= MAX_OUTLINE_LEVEL) {
      close(level, i);
      inherited.clear();
      const parent = open[open.length - 1];
      const headingText = headingMatch[2];
      const chapterMatch = level === 2 ? CHAPTER_RE.exec(headingText) : null;
      const kind: PlanHeading['kind'] = chapterMatch
        ? 'chapter'
        : parent?.kind === 'chapter' || parent?.kind === 'scene'
          ? 'scene'
          : 'section';
      const heading: PlanHeading = {
        kind,
        level,
        heading: headingText,
        title: chapterMatch ? chapterMatch[2].replace(TRAILING_PAREN_RE, '') : headingText,
        code: chapterMatch?.[1],
        pov: [],
        line: i,
        endLine: rawLines.length,
        from: lineStarts[i],
        to: text.length,
        markers: {},
        children: [],
      };
      (parent ? parent.children : outline).push(heading);
      if (kind === 'chapter') {
        chapters.push(heading);
        i = readPovLines(rawLines, lineStarts, i + 1, heading.pov) - 1;
      }
      open.push(heading);
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) continue;

    const indent = indentWidth(raw);
    const markers = lineMarkers(raw);
    for (const [marker, markerIndent] of inherited) {
      if (indent > markerIndent) {
        if (!markers.includes(marker)) markers.push(marker);
      } else {
        inherited.delete(marker);
      }
    }
    for (const marker of markers) {
      if (INHERITED_MARKERS.has(marker) && !inherited.has(marker)) inherited.set(marker, indent);
      for (const heading of open) {
        heading.markers[marker] = (heading.markers[marker] ?? 0) + 1;
      }
    }

    const chapter = open.find((heading) => heading.kind === 'chapter');
    lines.push({
      line: i,
      text: trimmed.replace(LIST_MARKER_RE, ''),
      chapterCode: chapter?.code,
      headingTitle: open[open.length - 1]?.title,
      markers,
    });
  }
  close(1, rawLines.length);

  return { outline, chapters, lines };
}

/** Collect consecutive `PoV:` lines (blank lines allowed between). Returns the first line after them. */
function readPovLines(rawLines: string[], lineStarts: number[], from: number, into: PlanPov[]): number {
  let next = from;
  for (let i = from; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (!trimmed) continue;
    const match = POV_RE.exec(trimmed);
    if (!match) break;
    into.push({
      characterId: match[1],
      name: match[2].trim(),
      line: i,
      from: lineStarts[i],
      to: lineStarts[i] + rawLines[i].length,
    });
    next = i + 1;
  }
  return next;
}

/** Leading chapter code of a manuscript file name (`2180-paseo.typ` → "2180"). */
export function manuscriptChapterCode(fileName: string): string | null {
  const base = fileName.replace(/^.*[\\/]/, '');
  return /^(\d{3,5})(?=[-_ .])/.exec(base)?.[1] ?? null;
}

/** A part of the plan the focus editor can show on its own: a `#` section's intro, or a `##` section/chapter. */
export interface PlanFocusTarget {
  heading: PlanHeading;
  from: number;
  to: number;
}

/**
 * Focus targets in document order. A `#` section covers only its intro text
 * (up to its first child), so each line belongs to exactly one target.
 */
export function planFocusTargets(plan: ParsedBookPlan): PlanFocusTarget[] {
  const targets: PlanFocusTarget[] = [];
  const visit = (headings: PlanHeading[]): void => {
    for (const heading of headings) {
      if (heading.level === 1) {
        targets.push({ heading, from: heading.from, to: heading.children[0]?.from ?? heading.to });
        visit(heading.children);
      } else if (heading.level === 2) {
        targets.push({ heading, from: heading.from, to: heading.to });
      }
    }
  };
  visit(plan.outline);
  return targets;
}

/** The focus target containing a 0-based line, or null before the first heading. */
export function focusTargetAtLine(targets: PlanFocusTarget[], line: number): PlanFocusTarget | null {
  let found: PlanFocusTarget | null = null;
  for (const target of targets) {
    if (target.heading.line > line) break;
    found = target;
  }
  return found;
}

/** Outline headings enclosing a 0-based line, outermost first (e.g. phase › chapter › scene). */
export function headingTrail(plan: ParsedBookPlan, line: number): PlanHeading[] {
  const trail: PlanHeading[] = [];
  let level = plan.outline;
  for (;;) {
    const next = level.find((heading) => heading.line <= line && line < heading.endLine);
    if (!next) return trail;
    trail.push(next);
    level = next.children;
  }
}

/** All outline headings in document order. */
export function flattenOutline(plan: ParsedBookPlan): PlanHeading[] {
  const out: PlanHeading[] = [];
  const visit = (headings: PlanHeading[]): void => {
    for (const heading of headings) {
      out.push(heading);
      visit(heading.children);
    }
  };
  visit(plan.outline);
  return out;
}

/** Stable chip color for a PoV character. */
export function povColor(characterId: string): string {
  let hash = 0;
  for (const ch of characterId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 45%)`;
}
