import { extractWikiLinks, WikiLinkTargets } from './wiki-links.utils';

/** Rewrite only prose links that previously resolved to this record, preserving labels and headings. */
export function rewriteRenamedLinks(content: string, targets: WikiLinkTargets, id: string, route: string, replacement: string): { content: string; count: number } {
  let result = content;
  let count = 0;
  for (const span of extractWikiLinks(content).reverse()) {
    const resolved = targets.resolve(span.target);
    if (resolved.state !== 'resolved' || resolved.id !== id || resolved.route !== route) continue;
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
