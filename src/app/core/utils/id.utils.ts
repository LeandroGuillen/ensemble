/**
 * Utility functions for ID generation
 *
 * Consolidates duplicate ID generation logic that appears across multiple services.
 */

/**
 * Generates a unique ID using timestamp and random component
 *
 * Format: base36(timestamp) + base36(random)
 * Example: "m0k3r5abc123"
 *
 * This provides a sortable ID (by creation time) with sufficient randomness
 * to avoid collisions in typical use cases.
 *
 * @returns A unique identifier string
 *
 * @example
 * ```typescript
 * const characterId = generateId(); // "m0k3r5abc123"
 * const projectId = generateId();   // "m0k3r5def456"
 * ```
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Converts a slug to an ID format (for backward compatibility)
 *
 * Replaces all non-alphanumeric characters with hyphens and converts to lowercase.
 *
 * @param slug - The slug string to convert
 * @returns The ID-formatted string
 *
 * @example
 * ```typescript
 * slugToId("John Doe!"); // "john-doe-"
 * slugToId("main_character"); // "main-character"
 * ```
 */
export function slugToId(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}
