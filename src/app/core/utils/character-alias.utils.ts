/**
 * Utilities for character alternative names (a.k.a.'s).
 */

/** Coerces a raw frontmatter `aliases` value into a clean string[]. */
export function normalizeAliases(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? [raw]
      : [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const alias = item.trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}

/** Case-insensitive substring match of a search term against a single alias. */
export function aliasMatchesSearch(alias: string, searchTerm: string): boolean {
  return !!searchTerm && alias.toLowerCase().includes(searchTerm.toLowerCase());
}

/** Case-insensitive substring match of a search term against any alias. */
export function aliasesMatchSearch(
  aliases: string[] | undefined,
  searchTerm: string
): boolean {
  return !!aliases && !!searchTerm && aliases.some((alias) => aliasMatchesSearch(alias, searchTerm));
}

/** First alias that contains the search term, if any. */
export function firstMatchingAlias(
  aliases: string[] | undefined,
  searchTerm: string
): string | undefined {
  if (!aliases?.length || !searchTerm) return undefined;
  return aliases.find((alias) => aliasMatchesSearch(alias, searchTerm));
}
