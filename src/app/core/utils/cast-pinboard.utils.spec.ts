import { reconcileCastPinboard } from './cast-pinboard.utils';

describe('cast canvas layout', () => {
  it('places new members in unoccupied positions and deduplicates membership', () => {
    const result = reconcileCastPinboard({ id: 'cast', name: 'Cast', characterIds: ['a', 'b', 'b', 'c'] }, {
      id: 'cast', name: 'Cast', nodes: [{ id: 'a', name: 'A', position: { x: 0, y: 0 } }], edges: [],
    });
    expect(result.nodes.length).toBe(3);
    expect(new Set(result.nodes.map(node => `${node.position.x},${node.position.y}`)).size).toBe(3);
  });
});
