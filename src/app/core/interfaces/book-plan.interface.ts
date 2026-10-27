/** Where a book's plan lives (stored on `Book.plan` in ensemble.json). */
export interface BookPlanSettings {
  /** Plan Markdown file, relative to the project root (e.g. "libros/b2/b2.plan.md"). */
  path: string;
  /** Folder of manuscript chapter files named `<code>-<slug>.*`, relative to the project root. */
  manuscriptDir?: string;
}

/** Line markers recognised in a plan, counted per heading and indexed per line. */
export type PlanMarker = 'todo' | 'ojo' | 'relectura' | 'oculto' | 'lugar' | 'objetivo';

export type PlanMarkerCounts = Partial<Record<PlanMarker, number>>;

/** A `PoV: <character_id> <character_name>` line directly below a chapter heading. */
export interface PlanPov {
  characterId: string;
  /** Name as written in the file; display only, the ID is authoritative. */
  name: string;
  /** 0-based line of the `PoV:` line, and its character offsets (line break excluded). */
  line: number;
  from: number;
  to: number;
}

export interface PlanHeading {
  /** `#` sections (phases, Setup…), `## <code> - <title>` chapters, `###` scenes inside a chapter. */
  kind: 'section' | 'chapter' | 'scene';
  level: number;
  /** Heading text as written (used for Obsidian-style `[[file#heading]]` links). */
  heading: string;
  /** Display title: chapter code and a trailing `(…)` POV note removed. */
  title: string;
  /** Chapter code, e.g. "2180". Only on chapters. */
  code?: string;
  pov: PlanPov[];
  /** 0-based line of the heading. */
  line: number;
  /** 0-based line where this heading's content ends (exclusive): next heading of the same or higher level, or EOF. */
  endLine: number;
  /** Character offsets of the same range, for editor ranges. */
  from: number;
  to: number;
  /** Marker counts in this heading's whole range (children included). */
  markers: PlanMarkerCounts;
  children: PlanHeading[];
}

/** One non-empty, non-heading line, for search. */
export interface PlanLine {
  line: number;
  text: string;
  /** Code of the enclosing chapter, if any. */
  chapterCode?: string;
  /** Title of the innermost enclosing heading. */
  headingTitle?: string;
  markers: PlanMarker[];
}

export interface ParsedBookPlan {
  /** Top-level headings with their children (levels 1–3). */
  outline: PlanHeading[];
  /** All chapters in document order. */
  chapters: PlanHeading[];
  lines: PlanLine[];
}
