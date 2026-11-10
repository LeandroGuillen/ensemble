export interface CharacterPrompt {
  name: string;
  positive: string;
  negative: string;
}

/** Where a character lives from a date on (until the next row). */
export interface CharacterResidence {
  /** World date as written, e.g. "322-05". */
  from: string;
  /** Location id. */
  place: string;
  /** e.g. "lost at sea"; shown as a missing (dashed) stretch on lifelines when set. */
  note?: string;
}

/** Timeline fields shared by characters, their form data and frontmatter. */
export interface CharacterLife {
  /** World date of birth as written (`312`, `c. 1`). */
  born?: string;
  /** World date of death as written. */
  died?: string;
  residence?: CharacterResidence[];
}

export interface Character extends CharacterLife {
  /** Background figure; separate from active characters and incomplete drafts. */
  lore?: boolean;
  /** Stable identity stored in frontmatter; survives rename/move. */
  id: string;
  /** In-memory staging state, derived from the `@drafts` folder for folder-based records. */
  draft?: boolean;
  name: string;
  /** Alternative names (a.k.a.'s); matched by character search, subtle in lists. */
  aliases?: string[];
  category: string;
  tags: string[];
  books: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  /** Optional per-book tag overrides; missing keys fall back to `tags`. */
  bookTags?: Record<string, string[]>;
  /** Map of character-style id → opaque wiki-link / path string */
  thumbnails?: Record<string, string>;
  /** Optional per-book map of character-style id → opaque wiki-link / path string. */
  bookThumbnails?: Record<string, Record<string, string>>;
  /**
   * Legacy frontmatter prompts, read only so PromptService can move them into
   * the prompts folder. Empty once migrated; new prompts live in prompt files.
   */
  prompts: CharacterPrompt[];
  content: string; // Full markdown body below frontmatter
  created: Date;
  modified: Date;
  /** Path relative to the project's characters/ folder (location only). */
  relativePath: string;
  filePath: string;
}

export interface CharacterFormData extends CharacterLife {
  lore?: boolean;
  name: string;
  /** Alternative names (a.k.a.'s); omitted or empty when none. */
  aliases?: string[];
  category: string;
  tags: string[];
  books: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  /** Optional per-book tag overrides; missing keys fall back to `tags`. */
  bookTags?: Record<string, string[]>;
  thumbnails?: Record<string, string>;
  /** Optional per-book map of character-style id → opaque wiki-link / path string. */
  bookThumbnails?: Record<string, Record<string, string>>;
  /** Legacy: prompts now live in prompt files. Omit to keep what is stored. */
  prompts?: CharacterPrompt[];
  content: string;
}

export interface CharacterFrontmatter {
  lore?: boolean;
  /** Stable character identity; assigned on first load when missing. */
  id?: string;
  /** Optional only for drafts. Active character files still require a name. */
  name?: string;
  /** Legacy flat-file draft marker; folder-based drafts use their `@drafts` location. */
  draft?: boolean;
  /** Alternative names (a.k.a.'s); omitted when empty. Accepts a list or a single string. */
  aliases?: string[] | string;
  category?: string;
  tags?: string[];
  books?: string[];
  /** Optional per-book category overrides; missing keys fall back to `category`. */
  bookCategories?: Record<string, string>;
  /** Optional per-book tag overrides; missing keys fall back to `tags`. */
  bookTags?: Record<string, string[]>;
  thumbnails?: Record<string, string>;
  /** Optional per-book map of character-style id → opaque wiki-link / path string. */
  bookThumbnails?: Record<string, Record<string, string>>;
  prompts?: CharacterPrompt[];
  /** YAML may read these as numbers or Dates; see `normalizeLifeDate`. */
  born?: string | number | Date;
  died?: string | number | Date;
  residence?: unknown;
  created?: string;
  modified?: string;
}
