import { pathJoin } from './path.utils';

/**
 * Parses a thumbnail reference from character frontmatter.
 * Supports Obsidian wiki-link format [[path]] and plain paths.
 *
 * @param raw - Raw thumbnail string (e.g. "[[img/dessir.png]]" or "img/dessir.png")
 * @returns Extracted path or null if empty/invalid
 */
export function parseThumbnailReference(raw: string): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  // Obsidian wiki-link: [[path]] or [[path|label]]
  const wikiMatch = trimmed.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (wikiMatch) {
    return wikiMatch[1].trim() || null;
  }
  return trimmed;
}

/**
 * Resolves a thumbnail reference to an absolute file path.
 *
 * @param projectPath - Absolute path to the project root
 * @param thumbnailRef - Parsed thumbnail path (from parseThumbnailReference)
 * @returns Absolute path to the image file
 */
export function resolveThumbnailPath(projectPath: string, thumbnailRef: string): string {
  return pathJoin(projectPath, thumbnailRef);
}

/**
 * Returns the opaque thumbnail string for a character style, or null if unset.
 * Does not fall back to any other style.
 */
export function resolveThumbnailForStyle(
  thumbnails: Record<string, string> | undefined | null,
  styleId: string
): string | null {
  if (!styleId || !thumbnails || typeof thumbnails !== 'object') {
    return null;
  }
  const raw = thumbnails[styleId];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed || null;
}

/** Returns a book-specific thumbnail when present, otherwise the main thumbnail. */
export function resolveThumbnailForBookStyle(
  thumbnails: Record<string, string> | undefined | null,
  bookThumbnails: Record<string, Record<string, string>> | undefined | null,
  bookId: string | null | undefined,
  styleId: string
): string | null {
  if (bookId && bookThumbnails?.[bookId]) {
    const bookThumbnail = resolveThumbnailForStyle(bookThumbnails[bookId], styleId);
    if (bookThumbnail) return bookThumbnail;
  }
  return resolveThumbnailForStyle(thumbnails, styleId);
}

/** Formats a project-relative path as an Obsidian wiki-link. */
export function formatThumbnailWikiLink(relativePath: string): string {
  const trimmed = (relativePath || '').trim().replace(/^\/+/, '');
  return trimmed ? `[[${trimmed}]]` : '';
}

/** Cache key for a character thumbnail under a given style and optional book. */
export function thumbnailCacheKey(characterId: string, styleId: string, bookId?: string): string {
  return bookId ? `${characterId}:${bookId}:${styleId}` : `${characterId}:${styleId}`;
}

/** Normalizes a raw frontmatter thumbnails map into a clean Record. */
export function normalizeThumbnailsMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) {
      result[key.trim()] = trimmed;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Normalizes a raw frontmatter per-book thumbnails map into clean nested records. */
export function normalizeBookThumbnailsMap(
  raw: unknown,
  assignedBookIds?: string[]
): Record<string, Record<string, string>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const assigned = assignedBookIds ? new Set(assignedBookIds) : null;
  const result: Record<string, Record<string, string>> = {};

  for (const [bookId, styleMap] of Object.entries(raw as Record<string, unknown>)) {
    if (!bookId.trim() || (assigned && !assigned.has(bookId))) continue;
    const normalizedStyles = normalizeThumbnailsMap(styleMap);
    if (normalizedStyles) result[bookId] = normalizedStyles;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
