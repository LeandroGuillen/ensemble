export interface CharacterPrompt {
  name: string;
  positive: string;
  negative: string;
}

export interface Character {
  /** Stable identity stored in frontmatter; survives rename/move. */
  id: string;
  /** Explicit staging state. Missing/false means this is an active character. */
  draft?: boolean;
  name: string;
  /** Alternative names (a.k.a.'s); matched by character search, subtle in lists. */
  aliases?: string[];
  category: string;
  tags: string[];
  books: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  /** Map of character-style id → opaque wiki-link / path string */
  thumbnails?: Record<string, string>;
  /** Optional per-book map of character-style id → opaque wiki-link / path string. */
  bookThumbnails?: Record<string, Record<string, string>>;
  prompts: CharacterPrompt[]; // Image-generation prompts; first is the default
  content: string; // Full markdown body below frontmatter
  created: Date;
  modified: Date;
  /** Path relative to the project's characters/ folder (location only). */
  relativePath: string;
  filePath: string;
}

export interface CharacterFormData {
  name: string;
  /** Alternative names (a.k.a.'s); omitted or empty when none. */
  aliases?: string[];
  category: string;
  tags: string[];
  books: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  thumbnails?: Record<string, string>;
  /** Optional per-book map of character-style id → opaque wiki-link / path string. */
  bookThumbnails?: Record<string, Record<string, string>>;
  prompts: CharacterPrompt[];
  content: string;
}

export interface CharacterFrontmatter {
  /** Stable character identity; assigned on first load when missing. */
  id?: string;
  /** Optional only for drafts. Active character files still require a name. */
  name?: string;
  /** Drafts are excluded from all normal character consumers until promoted. */
  draft?: boolean;
  /** Alternative names (a.k.a.'s); omitted when empty. Accepts a list or a single string. */
  aliases?: string[] | string;
  category?: string;
  tags?: string[];
  books?: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  thumbnails?: Record<string, string>;
  /** Optional per-book map of character-style id → opaque wiki-link / path string. */
  bookThumbnails?: Record<string, Record<string, string>>;
  prompts?: CharacterPrompt[];
  created?: string;
  modified?: string;
}
