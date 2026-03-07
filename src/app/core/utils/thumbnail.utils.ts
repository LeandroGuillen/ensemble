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
