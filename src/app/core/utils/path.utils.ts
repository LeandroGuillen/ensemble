/**
 * Synchronous path utilities
 *
 * These utilities eliminate unnecessary IPC calls for path manipulation operations
 * that don't require filesystem access. Use these instead of ElectronService path
 * methods when you're just building or parsing paths.
 *
 * Decision Matrix:
 * - Use path.utils.ts: Building paths, parsing paths, string manipulation
 * - Use ElectronService: Reading filesystem, checking if files exist, moving files
 */

/**
 * Joins path segments into a single path
 *
 * Synchronous alternative to electronService.pathJoin() for cases where you're
 * just building paths without needing filesystem access.
 *
 * @param parts - Path segments to join
 * @returns The joined path with normalized separators
 *
 * @example
 * ```typescript
 * pathJoin('/home/user', 'project', 'characters', 'main.md')
 * // Returns: "/home/user/project/characters/main.md"
 *
 * pathJoin('/path//with///multiple', 'slashes')
 * // Returns: "/path/with/multiple/slashes"
 * ```
 */
export function pathJoin(...parts: string[]): string {
  return parts
    .filter(p => p && p.length > 0)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\\/g, '/');
}

/**
 * Gets the basename (filename) from a path
 *
 * Synchronous alternative to electronService.pathBasename().
 *
 * @param path - The path to extract basename from
 * @param ext - Optional extension to remove from the basename
 * @returns The basename with or without extension
 *
 * @example
 * ```typescript
 * pathBasename('/home/user/document.txt')
 * // Returns: "document.txt"
 *
 * pathBasename('/home/user/document.txt', '.txt')
 * // Returns: "document"
 *
 * pathBasename('/home/user/folder/')
 * // Returns: ""
 * ```
 */
export function pathBasename(path: string, ext?: string): string {
  const parts = path.split('/').filter(p => p.length > 0);
  let basename = parts[parts.length - 1] || '';
  if (ext && basename.endsWith(ext)) {
    basename = basename.slice(0, -ext.length);
  }
  return basename;
}

/**
 * Gets the directory name from a path
 *
 * Synchronous alternative to electronService.pathDirname().
 *
 * @param path - The path to extract dirname from
 * @returns The directory path
 *
 * @example
 * ```typescript
 * pathDirname('/home/user/document.txt')
 * // Returns: "/home/user"
 *
 * pathDirname('/home/user/folder/')
 * // Returns: "/home/user/folder"
 * ```
 */
export function pathDirname(path: string): string {
  const parts = path.split('/').filter(p => p.length > 0);
  return parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
}

/**
 * Gets the file extension from a path
 *
 * @param path - The path to extract extension from
 * @returns The extension including the dot, or empty string if no extension
 *
 * @example
 * ```typescript
 * pathExtname('/home/user/document.txt')
 * // Returns: ".txt"
 *
 * pathExtname('/home/user/document')
 * // Returns: ""
 *
 * pathExtname('/home/user/archive.tar.gz')
 * // Returns: ".gz"
 * ```
 */
export function pathExtname(path: string): string {
  const basename = pathBasename(path);
  const lastDot = basename.lastIndexOf('.');
  return lastDot === -1 ? '' : basename.slice(lastDot);
}
