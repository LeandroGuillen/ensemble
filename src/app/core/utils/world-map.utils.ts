import * as yaml from 'js-yaml';
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

export interface WorldMapRoad {
  from: string;
  to: string;
  label?: string;
}

export interface WorldMap {
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

  return { map: { pins, roads, notes: parsed.data.content } };
}

/** `names` adds a readable `name:` beside each id (ignored when reading). */
export function serializeWorldMap(map: WorldMap, names?: ReadonlyMap<string, string>): string {
  const frontmatter = {
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
  const body = yaml.dump(frontmatter, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
  const notes = map.notes.trim();
  return `---\n${body}---\n${notes ? `\n${notes}\n` : ''}`;
}

export const AUTO_LAYOUT_SPACING = 160;

/**
 * Places `locationIds` in a rough grid below whatever is already on the map
 * (or around the origin on an empty map). Returns only the new pins.
 */
export function autoLayoutPins(existing: readonly WorldMapPin[], locationIds: readonly string[]): WorldMapPin[] {
  if (locationIds.length === 0) return [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(locationIds.length)));
  let originX = 0;
  let originY = 0;
  if (existing.length > 0) {
    originX = Math.min(...existing.map((p) => p.x));
    originY = Math.max(...existing.map((p) => p.y)) + AUTO_LAYOUT_SPACING;
  } else {
    originX = -((columns - 1) * AUTO_LAYOUT_SPACING) / 2;
    originY = -((Math.ceil(locationIds.length / columns) - 1) * AUTO_LAYOUT_SPACING) / 2;
  }
  return locationIds.map((locationId, index) => ({
    locationId,
    x: Math.round(originX + (index % columns) * AUTO_LAYOUT_SPACING),
    y: Math.round(originY + Math.floor(index / columns) * AUTO_LAYOUT_SPACING),
  }));
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

export function removePin(map: WorldMap, locationId: string): WorldMap {
  return {
    ...map,
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
