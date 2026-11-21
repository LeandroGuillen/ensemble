/**
 * Utility functions for generating slugs (safe folder/file names) from strings
 */

/**
 * Sanitize a display name into a safe filename/folder segment (ASCII-oriented).
 * Synchronous replacement for the removed `sanitize-filename` IPC channel.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"|?*]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-_.]/g, '')
    .toLowerCase()
    .substring(0, 255);
}

/**
 * Converts a string into a URL-safe slug suitable for folder names
 * Preserves accented characters (á, é, í, ó, ú, ñ, etc.) for better readability
 * @param text - The text to convert to a slug
 * @returns A lowercase, hyphenated slug
 */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    // Replace spaces with hyphens
    .replace(/\s+/g, '-')
    // Remove invalid filename characters
    .replace(/[<>:"|?*\/\\]/g, '')
    // Remove non-letter/non-number characters except hyphens and underscores
    // Uses Unicode property escapes to preserve accented characters
    .replace(/[^\p{L}\p{N}\-_]+/gu, '')
    // Replace multiple hyphens with single hyphen
    .replace(/\-\-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    // Limit length to 100 characters for filesystem compatibility
    .substring(0, 100);
}

/**
 * ASCII-only slug for generated assets (images, downloads) that must work on any OS.
 * Accented letters are transliterated (José → jose); other non-ASCII letters are dropped.
 */
export function asciiSlugify(text: string): string {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"|?*\/\\]/g, '')
    .replace(/[^a-z0-9\-_]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .substring(0, 100);
}

/**
 * Next filename stem when duplicating a plot board file: increment a trailing `-123` or final digit run, else append `-2`.
 */
export function nextPlotBoardDuplicateStem(stem: string): string {
  const hyphenNumber = stem.match(/^(.+)-(\d+)$/);
  if (hyphenNumber) {
    const n = parseInt(hyphenNumber[2], 10) + 1;
    return `${hyphenNumber[1]}-${n}`;
  }
  const trailingDigits = stem.match(/^(.+?)(\d+)$/);
  if (trailingDigits && trailingDigits[1].length > 0) {
    const n = parseInt(trailingDigits[2], 10) + 1;
    return `${trailingDigits[1]}${n}`;
  }
  return `${stem}-2`;
}
