import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent } from 'mdast';
import { Location } from '../interfaces/location.interface';
import { escapeHtml, markdownToHtml } from './markdown.utils';

const parser = unified().use(remarkParse);

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase();
}

/** Resolve only unique matches. Explicit file paths take precedence over display names. */
function matchingLocations(
  target: string,
  locations: Location[],
  locationsFolder = 'locations'
): Location[] {
  const normalized = normalizePath(target);
  if (!normalized || normalized.includes('#')) return [];
  const folder = normalizePath(locationsFolder).replace(/\/$/, '');
  const pathMatches = locations.filter(location => {
    const path = normalizePath(location.relativePath);
    return normalized === path || normalized === `${folder}/${path}`;
  });
  if (pathMatches.length) return pathMatches;

  const matches = locations.filter(location =>
    location.name.trim().toLowerCase() === normalized ||
    normalizePath(location.relativePath).split('/').pop() === normalized
  );
  return matches;
}

export function resolveLocationLink(target: string, locations: Location[], locationsFolder = 'locations'): Location | undefined {
  const matches = matchingLocations(target, locations, locationsFolder);
  return matches.length === 1 ? matches[0] : undefined;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Render wikilinks only in prose, leaving code, Markdown links and embeds untouched. */
export function renderLocationMarkdown(
  content: string,
  locations: Location[],
  locationsFolder = 'locations'
): { html: string; missingLinks: string[] } {
  const missingLinks = new Set<string>();
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
    const matches = matchingLocations(target, locations, locationsFolder);
    const location = matches.length === 1 ? matches[0] : undefined;
    const missing = !matches.length && !target.includes('#');
    if (missing) missingLinks.add(target);
    const token = `${prefix}${replacements.length}END`;
    const html = location
      ? `<a href="#/location/${encodeURIComponent(location.id)}" title="${escapeAttribute(target)}">${escapeHtml(label)}</a>`
      : missing
        ? `<a class="unresolved-location-link" href="#/location?name=${encodeURIComponent(target)}&amp;fromLink=1" title="Open New Location with name: ${escapeAttribute(target)}">${escapeHtml(label)}</a>`
        : `<span class="unresolved-location-link" title="Location not found or ambiguous: ${escapeAttribute(target)}">${escapeHtml(label)}</span>`;
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

export function locationMarkdownToHtml(content: string, locations: Location[], locationsFolder = 'locations'): string {
  return renderLocationMarkdown(content, locations, locationsFolder).html;
}
