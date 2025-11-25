/**
 * Utility functions for handling Electron IPC responses
 *
 * These utilities eliminate repetitive IPC result checking patterns
 * that appear throughout the service layer.
 */

/**
 * Asserts that an IPC operation succeeded, throwing if it failed
 *
 * @param result - The IPC result object with success/error fields
 * @param operation - Human-readable operation name for error messages
 * @throws Error if result.success is false
 *
 * @example
 * ```typescript
 * const result = await this.electronService.createDirectory(path);
 * assertIpcSuccess(result, 'Create directory');
 * // Now TypeScript knows result.success is true
 * ```
 */
export function assertIpcSuccess<T>(
  result: { success: boolean; error?: string } & T,
  operation: string
): asserts result is { success: true } & T {
  if (!result.success) {
    throw new Error(`${operation} failed: ${result.error}`);
  }
}

/**
 * Wraps an async operation with standardized error handling
 *
 * @param operation - Human-readable operation name for error messages
 * @param fn - The async function to execute
 * @returns The result of the function
 * @throws Error with operation context if fn throws
 *
 * @example
 * ```typescript
 * async createCharacter(data: CharacterFormData): Promise<Character> {
 *   return withIpcError('Create character', async () => {
 *     // ... implementation
 *   });
 * }
 * ```
 */
export async function withIpcError<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`${operation} failed: ${error}`);
  }
}
