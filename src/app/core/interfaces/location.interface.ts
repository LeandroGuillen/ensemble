export interface Location {
  /** Stable identity stored in frontmatter; survives rename/move. */
  id: string;
  name: string;
  category: string;
  tags: string[];
  books: string[];
  /** Opaque wiki-link / path string for a single thumbnail. */
  thumbnail?: string;
  content: string;
  created: Date;
  modified: Date;
  /** Path relative to the project's locations/ folder. */
  relativePath: string;
  filePath: string;
}

export interface LocationFormData {
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  content: string;
}

export interface LocationFrontmatter {
  /** Stable location identity; assigned on first load when missing. */
  id?: string;
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  created?: string;
  modified?: string;
}
