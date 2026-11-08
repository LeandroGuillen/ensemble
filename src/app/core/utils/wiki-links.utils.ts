import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent } from 'mdast';
import { escapeHtml, markdownToHtml } from './markdown.utils';

export interface WikiLinkTarget {
  id: string;
  name: string;
  relativePath: string;
}

export interface WikiLinkOptions {
  folder: string;
  route: string;
  singular: string;
}

export interface WikiLinkCollection extends WikiLinkOptions {
  targets: WikiLinkTarget[];
  /**
   * Matches here count only when no other collection matches (drafts yield to published
   * records with the same name, so existing links stay stable). Never a creation destination.
   */
  secondary?: boolean;
}

/** Drop secondary-collection matches when a primary collection matches too. */
function preferPrimary<M extends { collection: WikiLinkCollection }>(matches: M[]): M[] {
  const primary = matches.filter(match => !match.collection.secondary);
  return primary.length ? primary : matches;
}

const parser = unified().use(remarkParse);

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase();
}

/** Characters that can't be written in a link target, so names with them are linked by path. */
const LINK_BREAKING_CHARS = /[#|\[\]]/;

/**
 * Ways to read a target as record + optional fragment, longest record first: the whole target
 * (a name such as "Unit #7"), then the text before each `#` from last to first.
 */
function recordReadings(target: string): { record: string; fragment?: string }[] {
  const readings: { record: string; fragment?: string }[] = [{ record: target.trim() }];
  for (let i = target.lastIndexOf('#'); i >= 0; i = i ? target.lastIndexOf('#', i - 1) : -1) {
    readings.push({ record: target.slice(0, i).trim(), fragment: target.slice(i + 1) });
  }
  return readings;
}

/** Resolve only unique matches. Explicit file paths take precedence over display names. */
function matchingRecords<T extends WikiLinkTarget>(
  record: string,
  targets: T[],
  folderName: string
): T[] {
  const normalized = normalizePath(record);
  if (!normalized) return [];
  const folder = normalizePath(folderName).replace(/\/$/, '');
  const pathMatches = targets.filter(entry => {
    const path = normalizePath(entry.relativePath);
    return normalized === path || normalized === `${folder}/${path}`;
  });
  if (pathMatches.length) return pathMatches;

  const matches = targets.filter(entry =>
    entry.name.trim().toLowerCase() === normalized ||
    normalizePath(entry.relativePath).split('/').pop() === normalized
  );
  return matches;
}

/** Matches for the longest reading of the target that matches anything. */
function matchingTargets<T extends WikiLinkTarget>(target: string, targets: T[], folderName: string): T[] {
  for (const { record } of recordReadings(target)) {
    const matches = matchingRecords(record, targets, folderName);
    if (matches.length) return matches;
  }
  return [];
}

export function resolveWikiLink<T extends WikiLinkTarget>(target: string, targets: T[], folder: string): T | undefined {
  const matches = matchingTargets(target, targets, folder);
  return matches.length === 1 ? matches[0] : undefined;
}

export interface ResolvedWikiLink {
  /** resolved: unique match; missing: no match (href opens creation); ambiguous: several or unsupported matches. */
  state: 'resolved' | 'missing' | 'ambiguous';
  /** Id of the resolved record; only present when `state` is `resolved`. */
  id?: string;
  /** Optional heading or block scroll hint, without the leading #. */
  fragment?: string;
  /**
   * The record part the link was read as: the whole target when a record has that full name
   * (e.g. "Unit #7"), otherwise the text before a heading `#`.
   */
  record: string;
  /** Hash route (e.g. `#/character/<id>`); absent when ambiguous. */
  href?: string;
  route: string;
  title: string;
}

/** Collections a project-folder prefix (e.g. `locations/...`) points at; empty when there is none. */
function explicitCollectionsFor(record: string, collections: WikiLinkCollection[]): WikiLinkCollection[] {
  const normalized = normalizePath(record);
  const matching = collections.filter(collection =>
    normalized.startsWith(normalizePath(collection.folder).replace(/\/$/, '') + '/')
  );
  // The longest matching folder wins; collections sharing it (characters and drafts) are all tried.
  const longest = Math.max(...matching.map(collection => normalizePath(collection.folder).replace(/\/$/, '').length));
  return matching.filter(collection => normalizePath(collection.folder).replace(/\/$/, '').length === longest);
}

interface WikiLinkReading {
  reading: { record: string; fragment?: string };
  explicitCollections: WikiLinkCollection[];
  matches: { entry: WikiLinkTarget; collection: WikiLinkCollection }[];
}

/**
 * The longest reading of the target that matches a record. A record whose full name contains
 * `#` wins over reading the `#` as a heading. Without any match, the shortest reading (the text
 * before the first `#`) is returned with no matches.
 */
function readWikiLinkTarget(target: string, collections: WikiLinkCollection[]): WikiLinkReading {
  const readings = recordReadings(target);
  const reading = readings[readings.length - 1];
  for (const candidate of readings) {
    const explicit = explicitCollectionsFor(candidate.record, collections);
    const candidates = explicit.length ? explicit : collections;
    const found = preferPrimary(candidates.flatMap(collection =>
      matchingRecords(candidate.record, collection.targets, collection.folder).map(entry => ({ entry, collection }))
    ));
    if (found.length) return { reading: candidate, explicitCollections: explicit, matches: found };
  }
  return { reading, explicitCollections: explicitCollectionsFor(reading.record, collections), matches: [] };
}

/**
 * The record part of a wiki link target as the resolver reads it (`Unit#7` when a record has
 * that name, `Mara` for `Mara#Backstory`), or `undefined` when no record matches any reading.
 */
/** Record part of a wiki link target as the link resolver reads it; `undefined` when nothing matches. */
export type WikiLinkRecordName = (target: string) => string | undefined;

export function wikiLinkRecordName(target: string, collections: WikiLinkCollection[]): string | undefined {
  const { reading, matches } = readWikiLinkTarget(target, collections);
  return matches.length ? reading.record : undefined;
}

/**
 * Resolve a wikilink target against collections (the first is the default destination).
 * A project folder prefix (e.g. `locations/...`) is authoritative, including for missing targets.
 */
export function resolveWikiLinkTarget(target: string, collections: WikiLinkCollection[]): ResolvedWikiLink {
  const { reading, explicitCollections, matches } = readWikiLinkTarget(target, collections);
  const record = reading.record;
  const resolved = matches.length === 1 ? matches[0] : undefined;
  const destination = resolved?.collection
    || explicitCollections.find(collection => !collection.secondary)
    || collections.find(collection => !collection.secondary)
    || collections[0];
  if (resolved) {
    return { state: 'resolved', ...(reading.fragment !== undefined ? { fragment: reading.fragment } : {}), id: resolved.entry.id, href: `#/${destination.route}/${encodeURIComponent(resolved.entry.id)}`, route: destination.route, title: target, record };
  }
  if (!matches.length && !target.includes('#')) {
    const creationName = explicitCollections.length
      ? target.trim().replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '') : target;
    return {
      state: 'missing',
      href: `#/${destination.route}?name=${encodeURIComponent(creationName)}&fromLink=1`,
      route: destination.route,
      title: `Open New ${destination.singular} with name: ${target}`,
      record,
    };
  }
  return { state: 'ambiguous', route: destination.route, title: `${destination.singular} not found or ambiguous: ${target}`, record };
}

export interface WikiLinkSuggestion {
  /** Text shown in the list and inserted as the display text for aliases. */
  label: string;
  /** Link target written inside [[...]]. */
  target: string;
  /** Secondary text, e.g. "Character" or "→ Dessir Galsea". */
  detail?: string;
  type?: string;
  /** Lower sorts later (aliases rank below names). */
  boost?: number;
}

export interface WikiLinkTargets {
  resolve: (target: string) => ResolvedWikiLink;
  /** Record part of a target as `resolve` reads it; `undefined` when nothing matches. */
  recordName: WikiLinkRecordName;
  suggestions: WikiLinkSuggestion[];
}

/**
 * Link resolver and `[[` completion entries for collections (the first is where missing links
 * are created). Targets with `aliases` also suggest each alias as `[[Name|Alias]]`.
 */
export function buildWikiLinkTargets(collections: WikiLinkCollection[]): WikiLinkTargets {
  // Names shared by several targets would be ambiguous, and names with `#`, `|`, `[` or `]` can't
  // be written as a target (`#` reads as a heading); link those by path instead.
  // A secondary (draft) name that also belongs to a primary record resolves to that record, so
  // only the secondary entry needs its path; primary entries count only primary names.
  const primaryCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const collection of collections) {
    for (const entry of collection.targets) {
      const key = entry.name.trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
      if (!collection.secondary) primaryCounts.set(key, (primaryCounts.get(key) || 0) + 1);
    }
  }
  const suggestions: WikiLinkSuggestion[] = [];
  for (const collection of collections) {
    for (const entry of collection.targets) {
      const name = entry.name.trim();
      if (!name) continue;
      const counts = collection.secondary ? nameCounts : primaryCounts;
      const target = counts.get(name.toLowerCase())! > 1 || LINK_BREAKING_CHARS.test(name)
        ? `${collection.folder.replace(/\/$/, '')}/${entry.relativePath.replace(/\.md$/i, '')}`
        : name;
      suggestions.push({ label: name, target, detail: collection.singular, type: collection.route });
      for (const alias of (entry as { aliases?: string[] }).aliases || []) {
        if (alias.trim()) suggestions.push({ label: alias.trim(), target, detail: `→ ${name}`, type: collection.route, boost: -1 });
      }
    }
  }
  return {
    resolve: (target) => resolveWikiLinkTarget(target, collections),
    recordName: (target) => wikiLinkRecordName(target, collections),
    suggestions,
  };
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A `[[wikilink]]` span found in prose. */
export interface WikiLinkSpan {
  /** Start offset of the `[[...]]` span in the source content. */
  start: number;
  /** End offset (exclusive) of the `[[...]]` span. */
  end: number;
  /** Link target written inside `[[...]]` (before any `|`). */
  target: string;
  /** Display text (after `|`, or the target when there is no `|`). */
  label: string;
}

/**
 * Extract `[[wikilink]]` spans from prose, leaving code, Markdown links and
 * embeds untouched and skipping embeds (`![[...]]`) and escapes (`\[[`).
 * Shared by the Markdown renderer and the backlink index so both see the same links.
 */
export function extractWikiLinks(content: string): WikiLinkSpan[] {
  const protectedRanges: { start: number; end: number }[] = [];
  const visit = (node: Root | RootContent) => {
    if (['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference'].includes(node.type)) {
      if (node.position) {
        protectedRanges.push({ start: node.position.start.offset!, end: node.position.end.offset! });
      }
      return;
    }
    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parser.parse(content));
  const pattern = /(?<!!|\\)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]*))?\]\]/g;
  const spans: WikiLinkSpan[] = [];
  for (const match of content.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (protectedRanges.some(range => start < range.end && end > range.start)) continue;
    const target = match[1].trim();
    if (!target) continue;
    const label = match[2]?.trim() || target;
    spans.push({ start, end, target, label });
  }
  return spans;
}

/** Render wikilinks only in prose, leaving code, Markdown links and embeds untouched. */
export function renderWikiLinkMarkdown<T extends WikiLinkTarget>(
  content: string,
  targets: T[],
  options: WikiLinkOptions,
  otherCollections: WikiLinkCollection[] = []
): { html: string; missingLinks: string[] } {
  const missingLinks = new Set<string>();
  const collections: WikiLinkCollection[] = [{ ...options, targets }, ...otherCollections];
  let prefix = 'ENSEMBLEWIKILINK';
  while (content.includes(prefix)) prefix += 'X';
  const replacements: { start: number; end: number; token: string; html: string }[] = [];
  for (const span of extractWikiLinks(content)) {
    const link = resolveWikiLinkTarget(span.target, collections);
    if (link.state === 'missing') missingLinks.add(span.target);
    const token = `${prefix}${replacements.length}END`;
    const html = link.state === 'resolved'
      ? `<a href="${escapeAttribute(link.href!)}" title="${escapeAttribute(span.target)}">${escapeHtml(span.label)}</a>`
      : link.state === 'missing'
        ? `<a class="unresolved-${link.route}-link" href="${escapeAttribute(link.href!)}" title="${escapeAttribute(link.title)}">${escapeHtml(span.label)}</a>`
        : `<span class="unresolved-${link.route}-link" title="${escapeAttribute(link.title)}">${escapeHtml(span.label)}</span>`;
    replacements.push({ start: span.start, end: span.end, token, html });
  }
  let source = content;
  for (const replacement of [...replacements].reverse()) {
    source = source.slice(0, replacement.start) + replacement.token + source.slice(replacement.end);
  }
  let html = markdownToHtml(source);
  for (const replacement of replacements) html = html.replace(replacement.token, replacement.html);
  return { html, missingLinks: [...missingLinks] };
}
