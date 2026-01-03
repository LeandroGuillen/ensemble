export interface ProjectMetadata {
  projectName: string;
  version: string;
  categories: Category[];
  tags: Tag[];
  casts: Cast[];
  books: Book[];
  imageTags?: string[]; // Image tags for character image library
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

export type CategoryFolderMode = 'flat' | 'auto' | 'specify';

export interface Category {
  id: string;
  name: string;
  color: string;
  description?: string;
  folderMode?: CategoryFolderMode;  // Default: 'auto' for backward compatibility
  folderPath?: string;              // Custom folder path, used when folderMode is 'specify'
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Cast {
  id: string;
  name: string;
  characterIds: string[];
  description?: string;      // Loaded from description.md in cast folder
  thumbnail?: string;         // Filename of thumbnail in cast folder
  folderPath?: string;        // Absolute path to cast folder
}

export interface Book {
  id: string;
  name: string;
  color: string;
  description?: string;
  status?: 'draft' | 'in-progress' | 'published' | 'archived';
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
}

export interface AiSettings {
  enabled: boolean;
  provider: 'ollama' | 'lm-studio' | 'openai' | 'anthropic';
  // Ollama/LM Studio settings
  localServerUrl: string;
  modelName: string;
  // Cloud API settings (optional)
  apiKey?: string;
  // Generation parameters
  temperature: number;
  maxTokens: number;
}

export interface ProjectSettings {
  defaultCategory: string;
  autoSave: boolean;
  fileWatchEnabled: boolean;
  lastRoute?: string;
  graphView?: GraphViewState;
  ai?: AiSettings;
  filterExpanded?: boolean;
}

export interface GraphViewState {
  zoomIndex: number;
  viewPosition: { x: number; y: number };
}

export interface Project {
  path: string;
  metadata: ProjectMetadata;
}