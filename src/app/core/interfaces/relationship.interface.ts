export interface Relationship {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  color: string;
  bidirectional: boolean;
}

export interface GraphNode {
  id: string;
  name: string;
  position: { x: number; y: number };
  category?: string;
  color?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: Relationship[];
}