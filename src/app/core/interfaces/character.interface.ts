export interface Character {
  id: string; // Derived at runtime from relative file path (e.g., "_dessir.md" or "subdir/_dessir.md")
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string; // Opaque string (e.g., wiki-link [[path/to/image.jpg]])
  content: string; // Full markdown body below frontmatter
  created: Date;
  modified: Date;
  filePath: string;
}

export interface CharacterFormData {
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  content: string;
}

export interface CharacterFrontmatter {
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  created?: string;
  modified?: string;
}
