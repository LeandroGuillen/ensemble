import { WikiLinkCollection, WikiLinkTarget, extractWikiLinks, resolveWikiLinkTarget, wikiLinkRecordName } from './wiki-links.utils';
import { normalizeAliases } from './character-alias.utils';
import { resolveThumbnailForStyle } from './thumbnail.utils';
import { Character } from '../interfaces/character.interface';
import { Location } from '../interfaces/location.interface';
import { House } from '../interfaces/house.interface';
import { Cast, ProjectMetadata } from '../interfaces/project.interface';
import { PlotBoard } from '../interfaces/plot-board.interface';
export interface HealthDocument { name: string; content: string; route: string[]; queryParams?: Record<string, string>; }
export interface HealthSnapshot {
  metadata: ProjectMetadata; characters: Character[]; drafts: Character[]; locations: Location[];
  houses: House[]; casts: Cast[]; boards: { path: string; board: PlotBoard }[]; documents: HealthDocument[];
}
export interface HealthFix { kind: 'house' | 'cast' | 'pinboard' | 'thread' | 'pov' | 'plan'; owner: string; field: string; missing: string; }
export interface HealthFinding extends HealthDocument { group: string; message: string; fix?: HealthFix; }
export function checkProjectHealth(data: HealthSnapshot): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const settings = data.metadata.settings;
  const collections: WikiLinkCollection[] = [
    { targets: data.characters, folder: settings.charactersFolder || 'characters', route: 'character', singular: 'Character' },
    { targets: data.locations, folder: settings.locationsFolder || 'locations', route: 'location', singular: 'Location' },
    { targets: data.houses, folder: 'houses', route: 'house', singular: 'House' },
    { targets: data.drafts, folder: settings.charactersFolder || 'characters', route: 'character-draft', singular: 'Draft', secondary: true },
  ];
  const documents: HealthDocument[] = [...data.documents];
  const names = new Map<string, Map<string, HealthDocument>>();
  // Narrow the candidates, then let the shared resolver apply path/name/alias and draft precedence.
  const normalize = (value: string) => value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '').toLowerCase();
  const indices = collections.map(collection => {
    const index = new Map<string, Set<WikiLinkTarget>>();
    for (const record of collection.targets) {
      const path = normalize(record.relativePath);
      for (const key of [record.name.trim().toLowerCase(), path, `${normalize(collection.folder)}/${path}`,
        path.split('/').pop()!, ...normalizeAliases(record.aliases).map(alias => alias.toLowerCase())]) {
        if (!index.has(key)) index.set(key, new Set());
        index.get(key)!.add(record);
      }
      const document = { name: record.name || '(unnamed)', content: 'content' in record ? String(record.content) : '',
        route: [`/${collection.route}`, record.id] };
      documents.push(document);
      for (const key of new Set([record.name, ...normalizeAliases(record.aliases)].map(value => value.trim().toLowerCase()).filter(Boolean))) {
        if (!names.has(key)) names.set(key, new Map());
        names.get(key)!.set(`${collection.route}:${record.id}`, document);
      }
    }
    return index;
  });
  const resolved = new Map<string, ReturnType<typeof resolveWikiLinkTarget>>();
  for (const document of documents) {
    for (const { target } of extractWikiLinks(document.content)) {
      if (!resolved.has(target)) {
        const readings = [target, ...Array.from(target.matchAll(/#/g), match => target.slice(0, match.index))].map(normalize);
        const candidates = collections.map((collection, i) => ({ ...collection,
          targets: [...new Set(readings.flatMap(key => [...(indices[i].get(key) || [])]))] }));
        resolved.set(target, resolveWikiLinkTarget(target, candidates));
      }
      const link = resolved.get(target)!;
      if (link.state !== 'resolved') findings.push({ ...document, group: 'Wiki links',
        message: `${link.state === 'missing' || (target.includes('#') && !wikiLinkRecordName(target, collections)) ? 'Unresolved' : 'Ambiguous'} link: ${target}` });
    }
  }
  for (const [name, records] of names) {
    if (records.size > 1) for (const document of records.values()) findings.push({ ...document,
      group: 'Duplicate names and aliases', message: `Name or alias “${name}” is shared by ${records.size} records` });
  }
  const style = settings.defaultCharacterStyle || 'default';
  for (const record of [...data.characters, ...data.drafts]) {
    if (!resolveThumbnailForStyle(record.thumbnails, style)) findings.push({ name: record.name || '(unnamed)', content: '',
      route: [record.draft ? '/character-draft' : '/character', record.id], group: 'Missing portraits', message: `Missing portrait for ${style}` });
  }
  const characterIds = new Set(data.characters.map(record => record.id));
  const locationIds = new Set(data.locations.map(record => record.id));
  const boardIds = new Set(data.metadata.pinboards?.map(board => board.id));
  const orphan = (ids: string[], valid: Set<string>, document: HealthDocument, fix: Omit<HealthFix, 'missing'>, safe: (id: string) => boolean = () => true) => {
    for (const missing of new Set(ids.filter(id => !valid.has(id)))) findings.push({ ...document,
      group: 'Orphaned IDs', message: `${fix.field}: missing ID ${missing}${safe(missing) ? '' : ' — choose a replacement head to preserve this reign'}`, ...(safe(missing) ? { fix: { ...fix, missing } } : {}) });
  };
  for (const house of data.houses) {
    const document = { name: house.name, content: '', route: ['/house', house.id] };
    const fix = { kind: 'house' as const, owner: house.id, field: 'Members' };
    orphan(house.characterIds, characterIds, document, fix);
    for (const reign of house.leadership) orphan(reign.characterIds, characterIds, document, { ...fix, field: `Leadership:${reign.id}` }, missing => reign.characterIds.some(id => id !== missing));
    if (house.seatId) orphan([house.seatId], locationIds, document, { ...fix, field: 'Seat' });
    if (house.currentLeadershipId) orphan([house.currentLeadershipId], new Set(house.leadership.map(reign => reign.id)), document, { ...fix, field: 'Current leadership' });
  }
  for (const cast of data.casts) {
    const document = { name: cast.name, content: '', route: ['/cast', cast.id] };
    orphan(cast.characterIds, characterIds, document, { kind: 'cast', owner: cast.id, field: 'Members' });
    if (cast.pinboardId) orphan([cast.pinboardId], boardIds, document, { kind: 'cast', owner: cast.id, field: 'Pinboard' });
  }
  for (const board of data.metadata.pinboards || []) {
    const cast = data.casts.find(cast => cast.pinboardId === board.id);
    const document = { name: board.name, content: '', route: cast ? ['/cast', cast.id, 'pinboard'] : ['/project-health', 'pinboard', board.id] };
    orphan(board.nodes.map(node => node.id), characterIds, document, { kind: 'pinboard', owner: board.id, field: 'Nodes' });
    const nodes = new Set(board.nodes.map(node => node.id).filter(id => characterIds.has(id)));
    for (const edge of board.edges) orphan([edge.source, edge.target], nodes, document,
      { kind: 'pinboard', owner: board.id, field: `Edge:${edge.id}` });
  }
  for (const { path, board } of data.boards) {
    for (const thread of board.threads) orphan(thread.characters, characterIds,
      { name: `${path} · ${thread.name}`, content: '', route: ['/plot-board', ...path.split('/')] },
      { kind: 'thread', owner: path, field: thread.id });
  }
  for (const book of data.metadata.books) orphan(book.povCharacterIds || [], characterIds,
    { name: book.name, content: '', route: ['/book', book.id] }, { kind: 'pov', owner: book.id, field: 'PoVs' });
  return findings;
}
