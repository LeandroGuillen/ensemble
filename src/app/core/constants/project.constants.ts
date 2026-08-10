/**
 * Project-level constants shared across services.
 *
 * Centralizes filenames, default folder paths, default metadata seeds, and
 * the relative-folder normalization rule that was previously duplicated inline
 * across `ProjectService`, `main.js`, and others.
 */

import { Category, Tag } from '../interfaces/project.interface';
import { DEFAULT_BASE_COLORS } from '../utils/color-palette.utils';

// ---- Filenames -------------------------------------------------------------
export const ENSEMBLE_JSON_FILE = 'ensemble.json';
export const LEGACY_METADATA_JSON_FILE = 'metadata.json';

// ---- Default relative folders / files --------------------------------------
export const DEFAULT_CHARACTERS_FOLDER = 'characters';
export const DEFAULT_IMAGES_FOLDER = 'img';

export const DEFAULT_CHARACTER_STYLE_ID = 'default';

export const DEFAULT_CHARACTER_STYLES: ReadonlyArray<{ id: string; name: string }> = [
  { id: DEFAULT_CHARACTER_STYLE_ID, name: 'Default' },
];
export const DEFAULT_CASTS_FOLDER = 'characters/casts';
export const DEFAULT_NAMES_FILE = 'characters/names.md';

// ---- Pinboard connection colors --------------------------------------------
/** Fallback color used when a `PinboardConnection` has no explicit color. */
export const DEFAULT_CONNECTION_COLOR = '#848484';
/** Fallback color used for connection labels with no explicit labelColor. */
export const DEFAULT_CONNECTION_LABEL_COLOR = '#ffffff';

// ---- Default category/tag seed for new projects ----------------------------
export const DEFAULT_CATEGORIES: ReadonlyArray<Category> = [
  { id: 'main-character', name: 'Main Character', color: DEFAULT_BASE_COLORS[0] },
  { id: 'supporting', name: 'Supporting Character', color: DEFAULT_BASE_COLORS[1] },
  { id: 'antagonist', name: 'Antagonist', color: DEFAULT_BASE_COLORS[2] },
  { id: 'minor', name: 'Minor Character', color: DEFAULT_BASE_COLORS[3] },
];

export const DEFAULT_TAGS: ReadonlyArray<Tag> = [
  { id: 'magic-user', name: 'Magic User', color: DEFAULT_BASE_COLORS[6] },
  { id: 'noble', name: 'Noble', color: DEFAULT_BASE_COLORS[7] },
  { id: 'warrior', name: 'Warrior', color: DEFAULT_BASE_COLORS[2] },
  { id: 'scholar', name: 'Scholar', color: DEFAULT_BASE_COLORS[5] },
];

// ---- Path normalization ----------------------------------------------------
/**
 * Normalizes a user-supplied relative folder string:
 * strips leading/trailing/duplicate slashes and falls back to `fallback`
 * when the input is empty (after trimming).
 *
 * @param folder raw value (may be undefined / blank)
 * @param fallback returned when `folder` is empty after normalization
 *
 * @example
 * normalizeRelativeFolder('characters', 'characters')        // 'characters'
 * normalizeRelativeFolder('//foo//bar/', 'characters')       // 'foo/bar'
 * normalizeRelativeFolder('  ', 'characters/casts')          // 'characters/casts'
 */
export function normalizeRelativeFolder(folder: string | undefined | null, fallback: string): string {
  const trimmed = (folder ?? '').trim();
  const normalized = trimmed.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  return normalized || fallback;
}