import { Cast, Pinboard } from '../interfaces/project.interface';

/** Build the canvas from membership without disturbing its existing layout. */
export function reconcileCastPinboard(cast: Cast, existing?: Pinboard): Pinboard {
  const ids = [...new Set(cast.characterIds)];
  const members = new Set(ids);
  const nodes = new Map(existing?.nodes.map(node => [node.id, node]));
  const occupied = new Set(existing?.nodes.map(node => `${node.position.x},${node.position.y}`));
  let slot = 0;
  return {
    ...existing,
    id: cast.pinboardId || cast.id,
    name: cast.name,
    nodes: ids.map(id => {
      const node = nodes.get(id);
      if (node) return node;
      let position: { x: number; y: number };
      do {
        position = { x: (slot % 5) * 200, y: Math.floor(slot / 5) * 200 };
        slot++;
      } while (occupied.has(`${position.x},${position.y}`));
      occupied.add(`${position.x},${position.y}`);
      return { id, name: id, position };
    }),
    edges: (existing?.edges || []).filter(edge => members.has(edge.source) && members.has(edge.target)),
  };
}
