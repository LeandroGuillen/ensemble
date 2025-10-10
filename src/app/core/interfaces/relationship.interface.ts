import { Relationship, GraphNode } from './project.interface';

// Re-export from project.interface to maintain backward compatibility
export type { Relationship, GraphNode } from './project.interface';

export interface GraphData {
  nodes: GraphNode[];
  edges: Relationship[];
}