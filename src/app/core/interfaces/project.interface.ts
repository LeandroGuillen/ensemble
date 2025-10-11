export interface ProjectMetadata {
  projectName: string;
  version: string;
  categories: Category[];
  tags: Tag[];
  settings: ProjectSettings;
  relationships?: {
    nodes: GraphNode[];
    edges: Relationship[];
  };
}

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

export interface Category {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ProjectSettings {
  defaultCategory: string;
  autoSave: boolean;
  fileWatchEnabled: boolean;
  graphView?: GraphViewState;
}

export interface GraphViewState {
  zoomIndex: number;
  viewPosition: { x: number; y: number };
}

export interface Project {
  path: string;
  metadata: ProjectMetadata;
}