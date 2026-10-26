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
}

const parser = unified().use(remarkParse);

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase();
}

/** Resolve only unique matches. Explicit file paths take precedence over display names. */
function matchingTargets<T extends WikiLinkTarget>(
  target: string,
  targets: T[],
  folderName: string
): T[] {
  const normalized = normalizePath(target);
  if (!normalized || normalized.includes('#')) return [];
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

export function resolveWikiLink<T extends WikiLinkTarget>(target: string, targets: T[], folder: string): T | undefined {
  const matches = matchingTargets(target, targets, folder);
  return matches.length === 1 ? matches[0] : undefined;
}

export interface ResolvedWikiLink {
  /** resolved: unique match; missing: no match (href opens creation); ambiguous: several or unsupported matches. */
  state: 'resolved' | 'missing' | 'ambiguous';
  /** Hash route (e.g. `#/character/<id>`); absent when ambiguous. */
  href?: string;
  route: string;
  title: string;
}

/**
 * Resolve a wikilink target against collections (the first is the default destination).
 * A project folder prefix (e.g. `locations/...`) is authoritative, including for missing targets.
 */
export function resolveWikiLinkTarget(target: string, collections: WikiLinkCollection[]): ResolvedWikiLink {
  const normalized = normalizePath(target);
  const explicitCollections = collections.filter(collection =>
    normalized.startsWith(normalizePath(collection.folder).replace(/\/$/, '') + '/')
  ).sort((a, b) => b.folder.length - a.folder.length);
  const candidates = explicitCollections.length ? [explicitCollections[0]] : collections;
  const matches = candidates.flatMap(collection =>
    matchingTargets(target, collection.targets, collection.folder).map(entry => ({ entry, collection }))
  );
  const resolved = matches.length === 1 ? matches[0] : undefined;
  const destination = resolved?.collection || explicitCollections[0] || collections[0];
  if (resolved) {
    return { state: 'resolved', href: `#/${destination.route}/${encodeURIComponent(resolved.entry.id)}`, route: destination.route, title: target };
  }
  if (!matches.length && !target.includes('#')) {
    const creationName = explicitCollections.length
      ? target.trim().replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '') : target;
    return {
      state: 'missing',
      href: `#/${destination.route}?name=${encodeURIComponent(creationName)}&fromLink=1`,
      route: destination.route,
      title: `Open New ${destination.singular} with name: ${target}`,
    };
  }
  return { state: 'ambiguous', route: destination.route, title: `${destination.singular} not found or ambiguous: ${target}` };
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
  suggestions: WikiLinkSuggestion[];
}

/**
 * Link resolver and `[[` completion entries for collections (the first is where missing links
 * are created). Targets with `aliases` also suggest each alias as `[[Name|Alias]]`.
 */
export function buildWikiLinkTargets(collections: WikiLinkCollection[]): WikiLinkTargets {
  // Names shared by several targets would be ambiguous; link those by path instead.
  const nameCounts = new Map<string, number>();
  for (const collection of collections) {
    for (const entry of collection.targets) {
      const key = entry.name.trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
  }
  const suggestions: WikiLinkSuggestion[] = [];
  for (const collection of collections) {
    for (const entry of collection.targets) {
      const name = entry.name.trim();
      if (!name) continue;
      const target = nameCounts.get(name.toLowerCase())! > 1
        ? `${collection.folder.replace(/\/$/, '')}/${entry.relativePath.replace(/\.md$/i, '')}`
        : name;
      suggestions.push({ label: name, target, detail: collection.singular, type: collection.route });
      for (const alias of (entry as { aliases?: string[] }).aliases || []) {
        if (alias.trim()) suggestions.push({ label: alias.trim(), target, detail: `→ ${name}`, type: collection.route, boost: -1 });
      }
    }
  }
  return { resolve: (target) => resolveWikiLinkTarget(target, collections), suggestions };
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  for (const match of content.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (protectedRanges.some(range => start < range.end && end > range.start)) continue;
    const target = match[1].trim();
    if (!target) continue;
    const label = match[2]?.trim() || target;
    const link = resolveWikiLinkTarget(target, collections);
    if (link.state === 'missing') missingLinks.add(target);
    const token = `${prefix}${replacements.length}END`;
    const html = link.state === 'resolved'
      ? `<a href="${escapeAttribute(link.href!)}" title="${escapeAttribute(target)}">${escapeHtml(label)}</a>`
      : link.state === 'missing'
        ? `<a class="unresolved-${link.route}-link" href="${escapeAttribute(link.href!)}" title="${escapeAttribute(link.title)}">${escapeHtml(label)}</a>`
        : `<span class="unresolved-${link.route}-link" title="${escapeAttribute(link.title)}">${escapeHtml(label)}</span>`;
    replacements.push({ start, end, token, html });
  }
  let source = content;
  for (const replacement of [...replacements].reverse()) {
    source = source.slice(0, replacement.start) + replacement.token + source.slice(replacement.end);
  }
  let html = markdownToHtml(source);
  for (const replacement of replacements) html = html.replace(replacement.token, replacement.html);
  return { html, missingLinks: [...missingLinks] };
}
