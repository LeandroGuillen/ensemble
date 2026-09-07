import { PlotBoard } from '../interfaces/plot-board.interface';
import { ProjectMetadata } from '../interfaces/project.interface';

/** Normalize a characters/-relative path for lookups and remaps. */
export function normalizeCharacterRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** True when an id still looks like a character file path (`_name.md` or `dir/_name.md`). */
export function isLegacyCharacterPathId(id: string): boolean {
  const normalized = normalizeCharacterRelativePath(id);
  return /(^|\/)_[^/]+\.md$/i.test(normalized);
}

export function remapCharacterId(id: string, idMap: ReadonlyMap<string, string>): string {
  return idMap.get(id) ?? idMap.get(normalizeCharacterRelativePath(id)) ?? id;
}

export function remapCharacterIdList(ids: string[] | undefined, idMap: ReadonlyMap<string, string>): string[] | undefined {
  if (!ids) {
    return ids;
  }
  return ids.map((id) => remapCharacterId(id, idMap));
}

/**
 * Rewrites `/character/<legacy-path>` session/router URLs to the stable id.
 * Query/hash suffixes are preserved.
 */
export function remapCharacterRoute(
  route: string,
  resolveId: (legacyId: string) => string | undefined
): string {
  const match = /^\/character\/([^?#]+)/.exec(route);
  if (!match || match[1] === 'new') {
    return route;
  }

  let raw = match[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep the raw segment when it is not URI-encoded.
  }

  const next = resolveId(raw);
  if (!next || next === raw) {
    return route;
  }

  return `/character/${encodeURIComponent(next)}${route.slice(match[0].length)}`;
}

export function remapProjectCharacterIds(
  metadata: ProjectMetadata,
  idMap: ReadonlyMap<string, string>
): boolean {
  if (idMap.size === 0) {
    return false;
  }

  let changed = false;
  const remap = (id: string): string => {
    const next = remapCharacterId(id, idMap);
    if (next !== id) {
      changed = true;
    }
    return next;
  };

  for (const cast of metadata.casts || []) {
    if (!cast.characterIds?.length) {
      continue;
    }
    cast.characterIds = cast.characterIds.map(remap);
  }

  for (const book of metadata.books || []) {
    if (!book.povCharacterIds?.length) {
      continue;
    }
    book.povCharacterIds = book.povCharacterIds.map(remap);
  }

  for (const board of metadata.pinboards || []) {
    for (const node of board.nodes || []) {
      node.id = remap(node.id);
    }
    for (const edge of board.edges || []) {
      edge.source = remap(edge.source);
      edge.target = remap(edge.target);
    }
  }

  const lastRoute = metadata.lastSession?.lastRoute;
  if (lastRoute) {
    const nextRoute = remapCharacterRoute(lastRoute, (id) => {
      const mapped = remapCharacterId(id, idMap);
      return mapped === id ? undefined : mapped;
    });
    if (nextRoute !== lastRoute && metadata.lastSession) {
      metadata.lastSession.lastRoute = nextRoute;
      changed = true;
    }
  }

  return changed;
}

export function remapPlotBoardCharacterIds(
  board: PlotBoard,
  idMap: ReadonlyMap<string, string>
): boolean {
  if (idMap.size === 0) {
    return false;
  }

  let changed = false;
  for (const thread of board.threads || []) {
    if (!thread.characters?.length) {
      continue;
    }
    const next = thread.characters.map((id) => remapCharacterId(id, idMap));
    if (next.some((id, index) => id !== thread.characters[index])) {
      thread.characters = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Maps leftover path-based refs onto stable ids. Basename-only keys are
 * included when that filename is unique in the project.
 */
export function buildCharacterIdRemap(
  characters: Array<{ id: string; relativePath: string }>
): Map<string, string> {
  const idMap = new Map<string, string>();
  const byBasename = new Map<string, Array<{ id: string; relativePath: string }>>();

  for (const character of characters) {
    const relativePath = normalizeCharacterRelativePath(character.relativePath);
    if (relativePath && relativePath !== character.id) {
      idMap.set(relativePath, character.id);
    }

    const basename = relativePath.split('/').pop() || relativePath;
    const list = byBasename.get(basename) || [];
    list.push(character);
    byBasename.set(basename, list);
  }

  for (const [basename, list] of byBasename) {
    if (list.length === 1 && basename && basename !== list[0].id && !idMap.has(basename)) {
      idMap.set(basename, list[0].id);
    }
  }

  return idMap;
}
