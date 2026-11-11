import {
  removeAreaPin, setLocationArea, removeLocationArea, normalizeAreaPoints,
  emptyWorldMaps,
  parseWorldMaps,
  serializeWorldMaps,
  setMapRules,
  isMapMember,
  includeMapLocation,
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

  it('round-trips background placement, visibility and opacity without changing pins', () => {
    const map = { ...emptyWorldMap(), background: {
      file: 'assets/maps/coast.svg', name: 'Coast.svg', x: -500, y: -250,
      width: 1000, height: 500, opacity: 0.65, visible: false,
    } };
    expect(parseWorldMap(serializeWorldMap(map)).map).toEqual(map);
    expect(parseWorldMap(serializeWorldMap(emptyWorldMap())).map.background).toBeUndefined();
  });

  it('protects files with invalid background paths or dimensions from being overwritten', () => {
    const background = { file: '../outside.svg', width: 100, height: 100, x: 0, y: 0 };
    expect(parseWorldMap(`---\nbackground: ${JSON.stringify(background)}\n---`).error).toBeTruthy();
    expect(parseWorldMap(`---\nbackground: ${JSON.stringify({ ...background, file: 'assets/maps/a.svg', width: -1 })}\n---`).error).toBeTruthy();
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
  it('loads legacy data as World map and preserves its original save format', () => {
    const map = { pins: [{ locationId: 'city', x: -20, y: 50 }], roads: [], notes: 'Coast notes.' };
    const text = serializeWorldMap(map);
    const result = parseWorldMaps(text);
    expect(result.error).toBeUndefined();
    expect(result.collection.maps).toEqual([{ id: 'world', name: 'World map', map }]);
    expect(serializeWorldMaps(result.collection)).toBe(text);
  });

  it('round-trips named maps with independent coordinates, roads, backgrounds and notes', () => {
    const collection = emptyWorldMaps();
    collection.maps[0].map = { pins: [{ locationId: 'city', x: 10, y: -20 }], roads: [], notes: 'World notes.' };
    collection.maps.push({ id: 'capital', name: 'Capital City', map: {
      pins: [{ locationId: 'city', x: 999, y: 500 }, { locationId: 'palace', x: 40, y: 50 }],
      roads: [{ from: 'city', to: 'palace', label: 'Royal way' }], notes: 'City notes.',
      background: { file: 'assets/maps/city.svg', name: 'City.svg', x: -500, y: -300, width: 1000, height: 600, opacity: 0.8, visible: true },
    } });
    const text = serializeWorldMaps(collection);
    expect(text).toContain('version: 2');
    const result = parseWorldMaps(text);
    expect(result.error).toBeUndefined();
    expect(result.collection).toEqual(collection);
    expect(text.endsWith('World notes.\n')).toBeTrue();
  });

  it('protects unknown collection versions, empty collections and duplicate map identities', () => {
    for (const text of ['---\nversion: 3\nmaps: []\n---', '---\nversion: 2\nmaps: []\n---',
      '---\nversion: 2\nmaps:\n  - {id: city, name: City, pins: [], roads: []}\n  - {id: city, name: Other, pins: [], roads: []}\n---',
      '---\nversion: 2\nmaps:\n  - {id: city, name: City, pins: [], roads: []}\n  - {id: other, name: city, pins: [], roads: []}\n---']) {
      expect(parseWorldMaps(text).error).toBeTruthy();
    }
  });



  it('round-trips automatic types and individual overrides in legacy and named files', () => {
    const map = { ...emptyWorldMap(), membership: { types: ['country', 'settlement'], include: ['palace'], exclude: ['hidden-city'] } };
    expect(parseWorldMap(serializeWorldMap(map)).map).toEqual(map);
    const collection = { maps: [{ id: 'continent', name: 'Continent', map }] };
    expect(parseWorldMaps(serializeWorldMaps(collection)).collection).toEqual(collection);
    const invalid = serializeWorldMap({ ...map, membership: { ...map.membership, types: ['typo'] } });
    expect(parseWorldMap(invalid).error).toBeTruthy();
  });

  it('includes current and future matching types, manual additions, and explicit exclusions', () => {
    const map = { ...emptyWorldMap(), membership: { types: ['settlement'], include: ['palace'], exclude: ['hidden-city'] } };
    expect(isMapMember(map, { id: 'new-city', type: 'settlement' })).toBeTrue();
    expect(isMapMember(map, { id: 'hidden-city', type: 'settlement' })).toBeFalse();
    expect(isMapMember(map, { id: 'palace', type: 'building' })).toBeTrue();
    expect(isMapMember(map, { id: 'new-city', type: 'building' })).toBeFalse();
    expect(isMapMember(map, { id: 'other-palace', type: 'building' })).toBeFalse();
  });

  it('keeps retained coordinates and deleted-location records without laying out newly included members', () => {
    const map = { pins: [{ locationId: 'country', x: 5, y: 6 }, { locationId: 'building', x: 50, y: 60 }, { locationId: 'gone', x: 70, y: 80 }],
      roads: [{ from: 'country', to: 'building' }, { from: 'country', to: 'gone' }], notes: 'Keep notes' };
    const next = setMapRules(map, { types: ['country', 'settlement'], include: [], exclude: [] },
      [{ id: 'country', type: 'country' }, { id: 'building', type: 'building' }, { id: 'new-city', type: 'settlement' }]);
    expect(next.pins).toEqual([map.pins[0], map.pins[2]]);
    expect(next.pins[0]).toBe(map.pins[0]);
    expect(next.roads).toEqual([{ from: 'country', to: 'gone' }]);
    expect(next.notes).toBe('Keep notes');
    expect(isMapMember(next, { id: 'new-city', type: 'settlement' })).toBeTrue();
    expect(map.pins.length).toBe(3);
  });

  it('keeps automatic removals excluded and allows explicit re-addition without touching other members', () => {
    const map = { ...emptyWorldMap(), membership: { types: ['settlement'], include: [], exclude: [] }, pins: [{ locationId: 'city', x: 20, y: 30 }] };
    const removed = removePin(map, 'city');
    expect(isMapMember(removed, { id: 'city', type: 'settlement' })).toBeFalse();
    expect(isMapMember(removed, { id: 'another-city', type: 'settlement' })).toBeTrue();
    const restored = includeMapLocation(removed, 'city');
    expect(isMapMember(restored, { id: 'city', type: 'settlement' })).toBeTrue();
    expect(restored.pins).toEqual([]);
  });

});

describe('location areas', () => {
  const points = [{ x: -100, y: -50 }, { x: 100, y: -50 }, { x: 0, y: 100 }];
  it('round-trips an area without a pin in legacy and named maps, including notes', () => {
    const map = setLocationArea({ ...emptyWorldMap(), notes: 'Keep these notes.' }, 'region', points, '#123456');
    expect(map.pins).toEqual([]);
    expect(isMapMember(map, { id: 'region' })).toBeTrue();
    const legacy = parseWorldMap(serializeWorldMap(map, new Map([['region', 'The North']])));
    expect(legacy.error).toBeUndefined();
    expect(legacy.map).toEqual(map);
    const collection = { maps: [{ id: 'north', name: 'North', map }, { id: 'south', name: 'South', map }] };
    expect(parseWorldMaps(serializeWorldMaps(collection)).collection).toEqual(collection);
  });
  it('removes only the area pin and its roads, retaining membership and the saved boundary', () => {
    const map = setLocationArea({ ...emptyWorldMap(),
      pins: [{ locationId: 'a', x: 10, y: 20 }, { locationId: 'b', x: 30, y: 40 }],
      roads: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    }, 'a', points);
    const next = removeAreaPin(map, 'a');
    expect(next.areas).toEqual(map.areas);
    expect(next.membership).toEqual(map.membership);
    expect(isMapMember(next, { id: 'a' })).toBeTrue();
    expect(next.pins).toEqual([{ locationId: 'b', x: 30, y: 40 }]);
    expect(next.roads).toEqual([{ from: 'b', to: 'c' }]);
    expect(parseWorldMap(serializeWorldMap(next)).map).toEqual(next);
    expect(removeAreaPin(map, 'b')).toBe(map);
  });
  it('replaces and removes overlays without changing pins, roads or membership', () => {
    const map = setLocationArea(setPinPosition(emptyWorldMap(), 'a', 10, 20), 'a', points);
    const replaced = setLocationArea(map, 'a', points.map(p => ({ x: p.x + 10, y: p.y })), '#abcdef');
    expect(replaced.areas!.length).toBe(1);
    const removed = removeLocationArea(replaced, 'a');
    expect(removed.areas).toEqual([]);
    expect(removed.pins).toEqual(map.pins);
    expect(removed.membership).toEqual(map.membership);
    expect(removePin(map, 'a').areas).toEqual([]);
    expect(setMapRules(map, { types: [], include: [], exclude: [] }, [{ id: 'a' }]).areas).toEqual([]);
  });
  it('rejects malformed areas without permitting the file to be overwritten', () => {
    for (const points of [[], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }]]) {
      expect(normalizeAreaPoints(points)).toBeNull();
    }
    expect(parseWorldMap('---\nareas: invalid\n---\n').error).toBeTruthy();
    const map = setLocationArea(emptyWorldMap(), 'a', points);
    expect(parseWorldMap(serializeWorldMap(map).replace('#6c8ebf', 'invalid')).error).toBeTruthy();
  });
});
