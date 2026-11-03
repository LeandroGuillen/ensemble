import {
  WikiLinkCollection,
  WikiLinkTarget,
  extractWikiLinks,
  resolveWikiLinkTarget,
  wikiLinkRecordTarget,
} from './wiki-links.utils';

/** Where a backlink came from. Lore and drafts are character records with a flag. */
export type BacklinkSourceType = 'character' | 'lore' | 'draft' | 'location' | 'house' | 'book';

/** A source document whose text may contain wiki-links (a description, book page or plan). */
export interface BacklinkSourceDoc {
  sourceType: BacklinkSourceType;
  /** Id of the record the document belongs to (for a book page/plan: its owner id). */
  sourceId: string;
  sourceName: string;
  /** Which part of the source (e.g. `Book page: lc1`); omitted for a record's description. */
  sourcePart?: string;
  /** Hash route to navigate to the source. */
  href: string;
  /** The document text to scan. */
  content: string;
}

/** One document that mentions the target record. */
export interface Backlink {
  sourceType: BacklinkSourceType;
  sourceId: string;
  sourceName: string;
  sourcePart?: string;
  href: string;
  /** Short context around the link. */
  snippet: string;
}

/** A wiki-link that could not be attributed to a single record (missing or ambiguous). */
export interface ExcludedLink {
  sourceType: BacklinkSourceType;
  sourceName: string;
  sourcePart?: string;
  /** The raw link target text (inside `[[...]]`). */
  target: string;
  state: 'missing' | 'ambiguous';
}

export interface BacklinkIndex {
  /** Resolved mentions keyed by target record id, in scan order. */
  byTargetId: Record<string, Backlink[]>;
  /** Links excluded because they don't resolve to a single record. */
  excluded: ExcludedLink[];
}

/** Display order and labels for grouping backlinks by source type. */
export const BACKLINK_SOURCE_GROUPS: { key: BacklinkSourceType; label: string }[] = [
  { key: 'character', label: 'Characters' },
  { key: 'lore', label: 'Lore' },
  { key: 'draft', label: 'Drafts' },
  { key: 'location', label: 'Locations' },
  { key: 'house', label: 'Houses' },
  { key: 'book', label: 'Books' },
];

const SNIPPET_RADIUS = 42;

/** Collapse whitespace and trim, so snippets stay on one line. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLowerCase();
}

/**
 * A short single-line context snippet around a link, with the link shown as its
 * display label and ellipses where the context is cut off.
 */
export function snippetFor(content: string, span: { start: number; end: number; label: string }): string {
  const before = content.slice(Math.max(0, span.start - SNIPPET_RADIUS), span.start);
  const after = content.slice(span.end, Math.min(content.length, span.end + SNIPPET_RADIUS));
  const lead = span.start > SNIPPET_RADIUS ? '…' : '';
  const tail = span.end + SNIPPET_RADIUS < content.length ? '…' : '';
  return tidy(`${lead}${before}[${span.label}]${after}${tail}`);
}

/**
 * Build a reverse index of wiki-link mentions from source documents.
 *
 * Each `[[link]]` that resolves to a single record becomes a backlink for that
 * record. Links that are missing or ambiguous are collected in `excluded`
 * instead of being attributed to any record.
 */
export function buildBacklinkIndex(
  docs: BacklinkSourceDoc[],
  collections: WikiLinkCollection[]
): BacklinkIndex {
  const byTargetId: Record<string, Backlink[]> = {};
  const excluded: ExcludedLink[] = [];
  for (const doc of docs) {
    for (const span of extractWikiLinks(doc.content)) {
      const resolved = resolveWikiLinkTarget(span.target, collections);
      if (resolved.state === 'resolved' && resolved.id) {
        const backlink: Backlink = {
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
          sourceName: doc.sourceName,
          sourcePart: doc.sourcePart,
          href: doc.href,
          snippet: snippetFor(doc.content, span),
        };
        (byTargetId[resolved.id] ||= []).push(backlink);
      } else if (resolved.state === 'missing' || resolved.state === 'ambiguous') {
        excluded.push({
          sourceType: doc.sourceType,
          sourceName: doc.sourceName,
          sourcePart: doc.sourcePart,
          target: span.target,
          state: resolved.state,
        });
      }
    }
  }
  return { byTargetId, excluded };
}

/** Whether a link target text refers to a record by its name or one of its aliases. */
export function targetRefersToName(target: string, name: string, aliases: string[] = []): boolean {
  const normalized = normalizeName(wikiLinkRecordTarget(target));
  if (!normalized) return false;
  if (normalizeName(name) === normalized) return true;
  return aliases.some((alias) => normalizeName(alias) === normalized);
}

/**
 * How many excluded links look like they refer to this record (by name or alias)
 * but could not be attributed to a single record.
 */
export function excludedCountFor(index: BacklinkIndex, name: string, aliases: string[] = []): number {
  return index.excluded.filter((link) => targetRefersToName(link.target, name, aliases)).length;
}

/** Group a record's backlinks by source type, in display order, dropping empty groups. */
export function groupBacklinks(
  backlinks: Backlink[]
): { key: BacklinkSourceType; label: string; items: Backlink[] }[] {
  const groups: { key: BacklinkSourceType; label: string; items: Backlink[] }[] = [];
  for (const { key, label } of BACKLINK_SOURCE_GROUPS) {
    const items = backlinks.filter((b) => b.sourceType === key);
    if (items.length) groups.push({ key, label, items });
  }
  return groups;
}

/** Convenience for tests and callers that have raw target lists. */
export function collectionsFrom(
  targets: {
    characters: WikiLinkTarget[];
    locations: WikiLinkTarget[];
    houses: WikiLinkTarget[];
    charactersFolder?: string;
    locationsFolder?: string;
  }
): WikiLinkCollection[] {
  return [
    { targets: targets.characters, folder: targets.charactersFolder || 'characters', route: 'character', singular: 'Character' },
    { targets: targets.locations, folder: targets.locationsFolder || 'locations', route: 'location', singular: 'Location' },
    { targets: targets.houses, folder: 'houses', route: 'house', singular: 'House' },
  ];
}
