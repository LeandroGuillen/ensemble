export interface ProjectMetadata {
  projectName: string;
  version: string;
  categories: Category[];
  tags: Tag[];
  settings: ProjectSettings;
}

export interface Category {
  id: string;
  name: string;
  color: string;
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
}

export interface Project {
  path: string;
  metadata: ProjectMetadata;
}