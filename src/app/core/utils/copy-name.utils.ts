import { asciiSlugify } from './slug.utils';

const COPY_SUFFIX = /\s*\(copy(?:\s+(\d+))?\)\s*$/i;

/**
 * Name for a duplicate: `X (copy)`, then `X (copy 2)`, `X (copy 3)`… Duplicating
 * `X (copy)` continues the same sequence. `taken` holds names (and wikilink
 * stems) already in use; matching is case-insensitive, and a candidate is also
 * skipped when its slug is taken, so `[[x-copy]]` style links stay unambiguous.
 * An empty name stays empty (drafts may be unnamed).
 */
export function nextCopyName(name: string, taken: Iterable<string>): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  const base = trimmed.replace(COPY_SUFFIX, '').trim() || trimmed;
  const used = new Set<string>();
  for (const value of taken) {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized) used.add(normalized);
  }
  const isFree = (candidate: string) =>
    !used.has(candidate.toLowerCase()) && !used.has(asciiSlugify(candidate).toLowerCase());

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
    if (isFree(candidate)) return candidate;
  }
}
