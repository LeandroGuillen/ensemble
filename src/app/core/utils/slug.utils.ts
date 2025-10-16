/**
 * Utility functions for generating slugs (safe folder/file names) from strings
 */

/**
 * Converts a string into a URL-safe slug suitable for folder names
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
    // Remove other non-alphanumeric characters except hyphens and underscores
    .replace(/[^\w\-]+/g, '')
    // Replace multiple hyphens with single hyphen
    .replace(/\-\-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    // Limit length to 100 characters for filesystem compatibility
    .substring(0, 100);
}

/**
 * Converts a filename to a human-readable field name
 * Examples:
 * - "another-file.md" → "Another File"
 * - "character-background.md" → "Character Background"
 * - "some_notes.md" → "Some Notes"
 *
 * @param filename - The filename to convert
 * @returns A human-readable field name
 */
export function filenameToFieldName(filename: string): string {
  // Remove .md extension
  let name = filename.replace(/\.md$/i, '');

  // Replace hyphens and underscores with spaces
  name = name.replace(/[-_]/g, ' ');

  // Capitalize first letter of each word
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Generates a unique slug by appending a timestamp
 * Used for trash folder names to avoid collisions
 *
 * @param slug - The base slug
 * @returns A slug with timestamp suffix
 */
export function slugifyWithTimestamp(slug: string): string {
  const timestamp = Date.now();
  return `${slug}-${timestamp}`;
}
