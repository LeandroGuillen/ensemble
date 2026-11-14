import { extractWikiLinks, WikiLinkCollection, WikiLinkTargets } from './wiki-links.utils';
import { normalizeAliases } from './character-alias.utils';

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

/** Another record that already answers to the name a record is being renamed to. */
export interface RenameConflict {
  id: string;
  /** The other record's name. */
  name: string;
  route: string;
  /** Collection label, e.g. "Character". */
  singular: string;
  /** Whether the new name is that record's name or one of its aliases. */
  via: 'name' | 'alias';
}

function sameRecord(collection: WikiLinkCollection, entryId: string, route: string, id: string): boolean {
  return collection.route === route && entryId === id;
}

/**
 * Other records (any collection) whose name or alias is `name`. The renamed record's own name
 * and aliases never conflict.
 */
export function findRenameConflicts(collections: WikiLinkCollection[], route: string, id: string, name: string): RenameConflict[] {
  const key = name.trim().toLowerCase();
  if (!key) return [];
  const conflicts: RenameConflict[] = [];
  for (const collection of collections) {
    for (const entry of collection.targets) {
      if (sameRecord(collection, entry.id, route, id)) continue;
      const via = entry.name.trim().toLowerCase() === key ? 'name'
        : normalizeAliases(entry.aliases).some(alias => alias.toLowerCase() === key) ? 'alias' : undefined;
      if (via) conflicts.push({ id: entry.id, name: entry.name.trim(), route: collection.route, singular: collection.singular, via });
    }
  }
  return conflicts;
}

/** The collections as they will read once record `id` in `route` is called `name`. */
export function collectionsAfterRename(collections: WikiLinkCollection[], route: string, id: string, name: string): WikiLinkCollection[] {
  return collections.map(collection => collection.route !== route ? collection : {
    ...collection,
    targets: collection.targets.map(entry => entry.id === id ? { ...entry, name } : entry),
  });
}

/** Per conflicting record: links that open it now and will open the renamed record, or nothing, afterwards. */
export interface RetargetCount { retarget: number; lost: number; }

export const conflictKey = (conflict: { route: string; id: string }) => `${conflict.route}:${conflict.id}`;

/**
 * Count prose links that currently resolve to one of the conflicting records and will not once the
 * rename is saved: `retarget` when they will open the renamed record, `lost` when they become
 * ambiguous or open something else. Adds into `counts` (keyed by `conflictKey`).
 */
export function countRetargetedLinks(content: string, before: WikiLinkTargets, after: WikiLinkTargets, conflicts: RenameConflict[], id: string, route: string, counts: Map<string, RetargetCount>): void {
  const keys = new Set(conflicts.map(conflictKey));
  for (const span of extractWikiLinks(content)) {
    const now = before.resolve(span.target);
    if (now.state !== 'resolved' || !now.id) continue;
    const key = conflictKey({ route: now.route, id: now.id });
    if (!keys.has(key)) continue;
    const next = after.resolve(span.target);
    if (next.state === 'resolved' && next.id === now.id && next.route === now.route) continue;
    const count = counts.get(key) || { retarget: 0, lost: 0 };
    if (next.state === 'resolved' && next.id === id && next.route === route) count.retarget++;
    else count.lost++;
    counts.set(key, count);
  }
}
