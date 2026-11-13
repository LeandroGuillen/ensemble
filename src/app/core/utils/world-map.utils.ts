import * as yaml from 'js-yaml';
import { Location, LOCATION_TYPES } from '../interfaces/location.interface';
import { parseMarkdown } from './markdown.utils';

/**
 * World map file (`world-map.md` at the project root).
 *
 * ```markdown
 * ---
 * pins:
 *   - location: m0k3r5abc123   # stable location id
 *     name: Grey Harbor        # informational; rewritten on save
 *     x: 120
 *     y: -40
 * roads:
 *   - from: m0k3r5abc123
 *     to: m0k3r5def456
 *     label: Coast road        # optional
 * ---
 *
 * (optional free notes, kept as is)
 * ```
 *
 * Coordinates are canvas units (no projection). Pins for locations that no
 * longer exist are kept, so an undone delete puts the place back on the map.
 */
export interface WorldMapPin {
  locationId: string;
  x: number;
  y: number;
}

export interface MapPoint { x: number; y: number; }

export interface WorldMapArea {
  locationId: string;
  points: MapPoint[];
  color: string;
}

export const DEFAULT_AREA_COLOR = '#6c8ebf';

export interface WorldMapRoad {
  from: string;
  to: string;
  label?: string;
}

export interface WorldMapBackground {
  /** Project-relative background image asset. Kept on disk for undo after replacement/removal. */
  file: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
}

export interface MapMembership {
  types: string[];
  include: string[];
  exclude: string[];
}

export interface WorldMap {
  membership?: MapMembership;
  background?: WorldMapBackground;
  areas?: WorldMapArea[];
  pins: WorldMapPin[];
  roads: WorldMapRoad[];
  /** Markdown body below the frontmatter, preserved verbatim. */
  notes: string;
}

export interface WorldMapParseResult {
  map: WorldMap;
  /** Set when the file could not be read as a world map (the map is then empty). */
  error?: string;
}

export function emptyWorldMap(): WorldMap {
  return { pins: [], roads: [], notes: '' };
}

const COORD_LIMIT = 1_000_000;

function toCoord(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)));
}

function toId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

/** Same pair in either direction is one road. */
export function roadKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Lenient parse: invalid pins/roads are dropped, the first pin for a location
 * wins, self-loops and duplicate roads are dropped.
 */
export function parseWorldMap(text: string): WorldMapParseResult {
  if (!text.trim()) return { map: emptyWorldMap() };
  const parsed = parseMarkdown<Record<string, unknown>>(text);
  if (!parsed.success || !parsed.data) {
    return { map: emptyWorldMap(), error: parsed.error || 'Could not read the world map file' };
  }
  const fm = parsed.data.frontmatter && typeof parsed.data.frontmatter === 'object'
    ? parsed.data.frontmatter
    : {};

  const pins: WorldMapPin[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(fm['pins']) ? fm['pins'] : []) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const locationId = toId(entry['location']);
    const x = toCoord(entry['x']);
    const y = toCoord(entry['y']);
    if (!locationId || x === null || y === null || seen.has(locationId)) continue;
    seen.add(locationId);
    pins.push({ locationId, x, y });
  }

  const roads: WorldMapRoad[] = [];
  const roadKeys = new Set<string>();
  for (const raw of Array.isArray(fm['roads']) ? fm['roads'] : []) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const from = toId(entry['from']);
    const to = toId(entry['to']);
    if (!from || !to || from === to) continue;
    const key = roadKey(from, to);
    if (roadKeys.has(key)) continue;
    roadKeys.add(key);
    const label = typeof entry['label'] === 'string' ? entry['label'].trim() : '';
    roads.push(label ? { from, to, label } : { from, to });
  }

  const areas: WorldMapArea[] = [];
  if (fm['areas'] != null) {
    if (!Array.isArray(fm['areas'])) return { map: emptyWorldMap(), error: 'Invalid map areas.' };
    const areaIds = new Set<string>();
    for (const raw of fm['areas']) {
      const entry = raw as Record<string, unknown> | null;
      const locationId = entry && toId(entry['location']);
      const points = entry && normalizeAreaPoints(entry['points']);
      const color = entry?.['color'] ?? DEFAULT_AREA_COLOR;
      if (!locationId || !points || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color) || areaIds.has(locationId)) {
        return { map: emptyWorldMap(), error: 'Invalid map area. Areas need a location, a color and at least three distinct boundary points.' };
      }
      areaIds.add(locationId);
      areas.push({ locationId, points, color });
    }
  }
  const membership = parseMapMembership(fm['membership']);
  if (fm['membership'] != null && !membership) {
    return { map: emptyWorldMap(), error: 'Invalid map location rules.' };
  }
  const background = parseMapBackground(fm['background']);
  if (fm['background'] != null && !background) {
    return { map: emptyWorldMap(), error: 'Invalid map background metadata. Check its asset path and dimensions.' };
  }
  return { map: { pins, roads, ...(areas.length ? { areas } : {}), notes: parsed.data.content, ...(background ? { background } : {}), ...(membership ? { membership } : {}) } };
}

/** `names` adds a readable `name:` beside each id (ignored when reading). */
export function serializeWorldMap(map: WorldMap, names?: ReadonlyMap<string, string>): string {
  const frontmatter = worldMapFrontmatter(map, names);
  const body = yaml.dump(frontmatter, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
  const notes = map.notes.trim();
  return `---\n${body}---\n${notes ? `\n${notes}\n` : ''}`;
}

function worldMapFrontmatter(map: WorldMap, names?: ReadonlyMap<string, string>) {
  return {
    ...(map.background ? { background: map.background } : {}),
    ...(map.membership ? { membership: map.membership } : {}),
    ...(map.areas?.length ? { areas: map.areas.map(area => ({
      location: area.locationId, ...(names?.get(area.locationId) ? { name: names.get(area.locationId) } : {}),
      color: area.color, points: area.points,
    })) } : {}),
    pins: map.pins.map((pin) => {
      const name = names?.get(pin.locationId);
      return name
        ? { location: pin.locationId, name, x: Math.round(pin.x), y: Math.round(pin.y) }
        : { location: pin.locationId, x: Math.round(pin.x), y: Math.round(pin.y) };
    }),
    roads: map.roads.map((road) =>
      road.label ? { from: road.from, to: road.to, label: road.label } : { from: road.from, to: road.to }
    ),
  };
}

/** Pure edits used by the service (each returns a new map). */
export function setPinPosition(map: WorldMap, locationId: string, x: number, y: number): WorldMap {
  const nx = toCoord(x) ?? 0;
  const ny = toCoord(y) ?? 0;
  const exists = map.pins.some((p) => p.locationId === locationId);
  return {
    ...map,
    pins: exists
      ? map.pins.map((p) => (p.locationId === locationId ? { ...p, x: nx, y: ny } : p))
      : [...map.pins, { locationId, x: nx, y: ny }],
  };
}

/** Convert a pinned area to an area-only location; roads need pin endpoints. */
export function removeAreaPin(map: WorldMap, locationId: string): WorldMap {
  if (!map.areas?.some(area => area.locationId === locationId)) return map;
  return {
    ...map,
    pins: map.pins.filter(pin => pin.locationId !== locationId),
    roads: map.roads.filter(road => road.from !== locationId && road.to !== locationId),
  };
}

export function removePin(map: WorldMap, locationId: string): WorldMap {
  return {
    ...map,
    ...(map.membership ? { membership: {
      ...map.membership,
      include: map.membership.include.filter(id => id !== locationId),
      exclude: [...new Set([...map.membership.exclude, locationId])],
    } } : {}),
    ...(map.areas ? { areas: map.areas.filter(area => area.locationId !== locationId) } : {}),
    pins: map.pins.filter((p) => p.locationId !== locationId),
    roads: map.roads.filter((r) => r.from !== locationId && r.to !== locationId),
  };
}

/** Adds the road, or removes it when the pair is already connected. */
export function toggleRoad(map: WorldMap, from: string, to: string): WorldMap {
  if (!from || !to || from === to) return map;
  const key = roadKey(from, to);
  const exists = map.roads.some((r) => roadKey(r.from, r.to) === key);
  return {
    ...map,
    roads: exists ? map.roads.filter((r) => roadKey(r.from, r.to) !== key) : [...map.roads, { from, to }],
  };
}

export function setRoadLabel(map: WorldMap, from: string, to: string, label: string): WorldMap {
  const key = roadKey(from, to);
  const trimmed = label.trim();
  return {
    ...map,
    roads: map.roads.map((r) => {
      if (roadKey(r.from, r.to) !== key) return r;
      return trimmed ? { from: r.from, to: r.to, label: trimmed } : { from: r.from, to: r.to };
    }),
  };
}

/** Restrict disk reads to imported assets inside this project. */
export function parseMapBackground(raw: unknown): WorldMapBackground | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  if (typeof b['file'] !== 'string' || !/^assets\/maps\/[a-zA-Z0-9_-]+\.(?:svg|png|jpe?g|webp|gif)$/.test(b['file'])) return undefined;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (![b['x'], b['y'], b['width'], b['height']].every(finite)) return undefined;
  const { x, y, width, height } = b as unknown as WorldMapBackground;
  if (Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT || width <= 0 || height <= 0 || width > COORD_LIMIT || height > COORD_LIMIT) return undefined;
  return {
    file: b['file'], name: typeof b['name'] === 'string' ? b['name'].slice(0, 255) : 'Map image',
    x, y, width, height,
    opacity: finite(b['opacity']) ? Math.max(0, Math.min(1, b['opacity'])) : 1,
    visible: b['visible'] !== false,
  };
}


export interface NamedWorldMap {
  id: string;
  name: string;
  map: WorldMap;
}

export interface WorldMapCollection {
  maps: NamedWorldMap[];
}

export function emptyWorldMaps(): WorldMapCollection {
  return { maps: [{ id: 'world', name: 'World map', map: emptyWorldMap() }] };
}

/** Legacy files become the first map in memory; loading never rewrites them. */
export function parseWorldMaps(text: string): { collection: WorldMapCollection; error?: string } {
  const fail = (error: string) => ({ collection: emptyWorldMaps(), error });
  const parsed = parseMarkdown<Record<string, unknown>>(text);
  if (!text.trim()) return { collection: emptyWorldMaps() };
  if (!parsed.success || !parsed.data) return fail(parsed.error || 'Could not read the maps file.');
  const fm = parsed.data.frontmatter && typeof parsed.data.frontmatter === 'object' ? parsed.data.frontmatter : {};
  if (!('maps' in fm) && !('version' in fm)) {
    const legacy = parseWorldMap(text);
    return legacy.error ? fail(legacy.error) : { collection: { maps: [{ id: 'world', name: 'World map', map: legacy.map }] } };
  }
  if (fm['version'] !== 2 || !Array.isArray(fm['maps']) || fm['maps'].length === 0) {
    return fail('Unsupported or invalid map collection. Expected version 2 with at least one map.');
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const maps: NamedWorldMap[] = [];
  for (const raw of fm['maps']) {
    if (!raw || typeof raw !== 'object') return fail('Invalid map entry.');
    const entry = raw as Record<string, unknown>;
    const id = entry['id'];
    const name = typeof entry['name'] === 'string' ? entry['name'].trim() : '';
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ids.has(id) || !name || name.length > 120 || names.has(name.toLowerCase())) {
      return fail('Each map needs a unique ID and name (up to 120 characters).');
    }
    if (!Array.isArray(entry['pins']) || !Array.isArray(entry['roads'])) return fail(`Invalid pins or roads in map "${name}".`);
    ids.add(id);
    names.add(name.toLowerCase());
    const notes = maps.length === 0 ? parsed.data.content : typeof entry['notes'] === 'string' ? entry['notes'] : '';
    const result = parseWorldMap(`---\n${yaml.dump({ membership: entry['membership'], background: entry['background'], areas: entry['areas'], pins: entry['pins'], roads: entry['roads'] })}---\n${notes}`);
    if (result.error) return fail(`${name}: ${result.error}`);
    maps.push({ id, name, map: result.map });
  }
  return { collection: { maps } };
}

export function serializeWorldMaps(collection: WorldMapCollection, names?: ReadonlyMap<string, string>): string {
  const first = collection.maps[0];
  // Preserve the original format until the user actually creates or renames a map.
  if (collection.maps.length === 1 && first.id === 'world' && first.name === 'World map') return serializeWorldMap(first.map, names);
  const fm = { version: 2, maps: collection.maps.map((entry, index) => ({
    id: entry.id, name: entry.name, ...worldMapFrontmatter(entry.map, names),
    ...(index > 0 && entry.map.notes ? { notes: entry.map.notes } : {}),
  })) };
  const body = yaml.dump(fm, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
  return `---\n${body}---\n${first.map.notes.trim() ? `\n${first.map.notes.trim()}\n` : ''}`;
}

function parseMapMembership(raw: unknown): MapMembership | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string' && id.trim().length > 0);
  if (!strings(value['types']) || !strings(value['include']) || !strings(value['exclude'])) return undefined;
  const validTypes = new Set<string>([...LOCATION_TYPES.map(type => type.value), 'unspecified']);
  if (!value['types'].every(type => validTypes.has(type))) return undefined;
  return { types: [...new Set(value['types'])], include: [...new Set(value['include'])], exclude: [...new Set(value['exclude'])] };
}

export function mapMembership(map: WorldMap): MapMembership {
  return map.membership || { types: [], include: [...new Set([...map.pins.map(pin => pin.locationId), ...(map.areas || []).map(area => area.locationId)])], exclude: [] };
}

export function isMapMember(map: WorldMap, location: Pick<Location, 'id' | 'type'>): boolean {
  const rules = mapMembership(map);
  return !rules.exclude.includes(location.id) && (rules.types.includes(location.type || 'unspecified') || rules.include.includes(location.id));
}

/** Locations this rule edit takes off the map: members under the current rules that are not members under the new ones.
 * Places that were already hidden (e.g. after a type change) or deleted keep their pins, areas and roads. */
function locationsLeavingMap(map: WorldMap, membership: MapMembership, locations: readonly Pick<Location, 'id' | 'type'>[]): Set<string> {
  const next = { ...map, membership };
  return new Set(locations.filter(location => isMapMember(map, location) && !isMapMember(next, location)).map(location => location.id));
}

export interface MapRulesRemovals { positions: number; areas: number; roads: number; }

/** What `setMapRules()` would drop, for the Apply preview. */
export function mapRulesRemovals(map: WorldMap, membership: MapMembership, locations: readonly Pick<Location, 'id' | 'type'>[]): MapRulesRemovals {
  const removed = locationsLeavingMap(map, membership, locations);
  return {
    positions: map.pins.filter(pin => removed.has(pin.locationId)).length,
    areas: (map.areas || []).filter(area => removed.has(area.locationId)).length,
    roads: map.roads.filter(road => removed.has(road.from) || removed.has(road.to)).length,
  };
}

/** Save rules without guessing geographical positions. Retained pins never move.
 * Only places this edit takes off the map lose their pins, areas and roads. */
export function setMapRules(map: WorldMap, membership: MapMembership, locations: readonly Pick<Location, 'id' | 'type'>[]): WorldMap {
  const next = { ...map, membership };
  const removed = locationsLeavingMap(map, membership, locations);
  return { ...next, ...(map.areas ? { areas: map.areas.filter(area => !removed.has(area.locationId)) } : {}), pins: map.pins.filter(pin => !removed.has(pin.locationId)), roads: map.roads.filter(road => !removed.has(road.from) && !removed.has(road.to)) };
}

export function includeMapLocation(map: WorldMap, id: string): WorldMap {
  const rules = mapMembership(map);
  return { ...map, membership: { ...rules, include: [...new Set([...rules.include, id])], exclude: rules.exclude.filter(value => value !== id) } };
}

/** Normalize to the same bounded canvas units as pins; reject degenerate boundaries. */
export function normalizeAreaPoints(raw: unknown): MapPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 2000) return null;
  const points: MapPoint[] = [];
  for (const point of raw) {
    if (!point || typeof point !== 'object') return null;
    const x = toCoord(point.x), y = toCoord(point.y);
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  if (new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) return null;
  const twiceArea = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  return Math.abs(twiceArea) > 0 ? points : null;
}

export function setLocationArea(map: WorldMap, locationId: string, points: MapPoint[], color = DEFAULT_AREA_COLOR): WorldMap {
  const boundary = normalizeAreaPoints(points);
  if (!locationId || !boundary || !/^#[0-9a-f]{6}$/i.test(color)) return map;
  const next = includeMapLocation(map, locationId);
  return { ...next, areas: [...(map.areas || []).filter(area => area.locationId !== locationId), { locationId, points: boundary, color }] };
}

/** Removing just the overlay keeps membership, pins and roads. */
export function removeLocationArea(map: WorldMap, locationId: string): WorldMap {
  return { ...map, areas: (map.areas || []).filter(area => area.locationId !== locationId) };
}
