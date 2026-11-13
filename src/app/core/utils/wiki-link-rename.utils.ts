import { extractWikiLinks, WikiLinkTargets } from './wiki-links.utils';

/**
 * Rewrite only prose links that previously resolved to this record, preserving labels and headings.
 * Links that reached the record through an alias are left exactly as written when `after` (the
 * targets once the rename is saved) still resolves them to the same record: the alias survives the
 * rename, and rewriting the target would change the visible text of the prose.
 */
export function rewriteRenamedLinks(content: string, before: WikiLinkTargets, after: WikiLinkTargets, id: string, route: string, replacement: string): { content: string; count: number } {
  let result = content;
  let count = 0;
  for (const span of extractWikiLinks(content).reverse()) {
    const resolved = before.resolve(span.target);
    if (resolved.state !== 'resolved' || resolved.id !== id || resolved.route !== route) continue;
    if (resolved.viaAlias) {
      const still = after.resolve(span.target);
      if (still.state === 'resolved' && still.id === id && still.route === route) continue;
    }
    const original = content.slice(span.start, span.end);
    const pipe = original.indexOf('|');
    const suffix = pipe >= 0 ? original.slice(pipe, -2) : '';
    const next = `[[${replacement}${resolved.fragment !== undefined ? '#' + resolved.fragment : ''}${suffix}]]`;
    if (next === original) continue;
    result = result.slice(0, span.start) + next + result.slice(span.end);
    count++;
  }
  return { content: result, count };
}
