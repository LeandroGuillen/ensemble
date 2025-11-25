/**
 * Utility functions for project validation
 *
 * Eliminates repetitive project null-checking patterns across services.
 */

import { Project } from '../interfaces/project.interface';

/**
 * Asserts that a project is loaded, throwing if not
 *
 * This is a TypeScript assertion function that narrows the type from
 * `Project | null` to `Project` after the check.
 *
 * @param project - The project to check (may be null)
 * @param operation - Optional operation name for better error messages
 * @throws Error if project is null
 *
 * @example
 * ```typescript
 * const project = this.projectService.getCurrentProject();
 * assertProjectLoaded(project, 'create character');
 * // Now TypeScript knows project is not null
 * const path = project.path; // No error
 * ```
 */
export function assertProjectLoaded(
  project: Project | null,
  operation?: string
): asserts project is Project {
  if (!project) {
    const msg = operation
      ? `Cannot ${operation}: No project loaded`
      : 'No project loaded';
    throw new Error(msg);
  }
}

/**
 * Gets a project or throws an error if null
 *
 * Convenience wrapper around assertProjectLoaded that returns the project.
 *
 * @param project - The project to check (may be null)
 * @returns The project (guaranteed non-null)
 * @throws Error if project is null
 *
 * @example
 * ```typescript
 * const project = requireProject(this.projectService.getCurrentProject());
 * // Guaranteed to be non-null here
 * ```
 */
export function requireProject(project: Project | null): Project {
  assertProjectLoaded(project);
  return project;
}
