import {
  autoLayoutPins,
  emptyWorldMap,
  parseWorldMap,
  removePin,
  serializeWorldMap,
  setPinPosition,
  setRoadLabel,
  toggleRoad,
} from './world-map.utils';

describe('world-map.utils', () => {
  it('reads pins, roads and notes from world-map.md', () => {
    const { map, error } = parseWorldMap(`---
pins:
  - location: a1
    name: Grey Harbor
    x: 120
    y: -40
  - location: b2
    x: "10.6"
    y: 0
roads:
  - from: a1
    to: b2
    label: Coast road
---

Rough sketch of the coast.
`);
    expect(error).toBeUndefined();
    expect(map.pins).toEqual([
      { locationId: 'a1', x: 120, y: -40 },
      { locationId: 'b2', x: 11, y: 0 },
    ]);
    expect(map.roads).toEqual([{ from: 'a1', to: 'b2', label: 'Coast road' }]);
    expect(map.notes).toBe('Rough sketch of the coast.');
  });

  it('drops invalid pins, duplicate pins, self-loops and duplicate roads', () => {
    const { map } = parseWorldMap(`---
pins:
  - location: a1
    x: 1
    y: 2
  - location: a1
    x: 9
    y: 9
  - location: c3
    x: nope
    y: 0
  - x: 1
    y: 1
  - "garbage"
roads:
  - from: a1
    to: a1
  - from: a1
    to: b2
  - from: b2
    to: a1
  - from: a1
---
`);
    expect(map.pins).toEqual([{ locationId: 'a1', x: 1, y: 2 }]);
    expect(map.roads).toEqual([{ from: 'a1', to: 'b2' }]);
  });

  it('treats an empty or missing file as an empty map', () => {
    expect(parseWorldMap('').map).toEqual(emptyWorldMap());
    expect(parseWorldMap('   \n').map).toEqual(emptyWorldMap());
  });

  it('reports broken YAML instead of silently returning an empty map', () => {
    const result = parseWorldMap('---\npins: [\n---\n');
    expect(result.error).toBeTruthy();
    expect(result.map.pins).toEqual([]);
  });

  it('round-trips through serialize, writing names for readability and keeping notes', () => {
    const map = {
      pins: [
        { locationId: 'a1', x: 120.4, y: -40 },
        { locationId: 'gone', x: 5, y: 5 },
      ],
      roads: [{ from: 'a1', to: 'gone', label: 'Old road' }],
      notes: 'Notes stay.',
    };
    const text = serializeWorldMap(map, new Map([['a1', 'Grey Harbor']]));
    expect(text).toContain('name: Grey Harbor');
    expect(text.startsWith('---\n')).toBeTrue();
    const back = parseWorldMap(text).map;
    expect(back.pins).toEqual([
      { locationId: 'a1', x: 120, y: -40 },
      { locationId: 'gone', x: 5, y: 5 },
    ]);
    expect(back.roads).toEqual(map.roads);
    expect(back.notes).toBe('Notes stay.');
  });

  it('auto-layout centres a grid on an empty map and goes below existing pins otherwise', () => {
    const fresh = autoLayoutPins([], ['a', 'b', 'c', 'd']);
    expect(fresh.length).toBe(4);
    expect(new Set(fresh.map((p) => `${p.x},${p.y}`)).size).toBe(4);
    const xs = fresh.map((p) => p.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBe(0);

    const below = autoLayoutPins([{ locationId: 'z', x: 50, y: 300 }], ['a']);
    expect(below).toEqual([{ locationId: 'a', x: 50, y: 460 }]);
    expect(autoLayoutPins([], [])).toEqual([]);
  });

  it('edits pins and roads immutably', () => {
    let map = emptyWorldMap();
    map = setPinPosition(map, 'a', 10, 20);
    map = setPinPosition(map, 'b', 0, 0);
    map = setPinPosition(map, 'a', 15.7, 20);
    expect(map.pins).toEqual([
      { locationId: 'a', x: 16, y: 20 },
      { locationId: 'b', x: 0, y: 0 },
    ]);

    const withRoad = toggleRoad(map, 'a', 'b');
    expect(withRoad.roads).toEqual([{ from: 'a', to: 'b' }]);
    expect(toggleRoad(withRoad, 'b', 'a').roads).toEqual([]);
    expect(toggleRoad(map, 'a', 'a')).toBe(map);

    const labelled = setRoadLabel(withRoad, 'b', 'a', '  Ford  ');
    expect(labelled.roads).toEqual([{ from: 'a', to: 'b', label: 'Ford' }]);
    expect(setRoadLabel(labelled, 'a', 'b', ' ').roads).toEqual([{ from: 'a', to: 'b' }]);

    const removed = removePin(labelled, 'a');
    expect(removed.pins).toEqual([{ locationId: 'b', x: 0, y: 0 }]);
    expect(removed.roads).toEqual([]);
    expect(labelled.pins.length).toBe(2);
  });
});
