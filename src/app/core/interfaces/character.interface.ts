export interface CharacterPrompt {
  name: string;
  positive: string;
  negative: string;
}

export interface Character {
  id: string; // Derived at runtime from relative file path (e.g., "_dessir.md" or "subdir/_dessir.md")
  name: string;
  category: string;
  tags: string[];
  books: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  /** Map of character-style id → opaque wiki-link / path string */
  thumbnails?: Record<string, string>;
  prompts: CharacterPrompt[]; // Image-generation prompts; first is the default
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
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  thumbnails?: Record<string, string>;
  prompts: CharacterPrompt[];
  content: string;
}

export interface CharacterFrontmatter {
  name: string;
  category: string;
  tags: string[];
  books: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  thumbnails?: Record<string, string>;
  prompts?: CharacterPrompt[];
  created?: string;
  modified?: string;
}
