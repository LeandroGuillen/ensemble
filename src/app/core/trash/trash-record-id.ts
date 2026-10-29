/**
 * Sanitize a record id for trash-manager staging.
 * Main only accepts kind/recordId matching [A-Za-z0-9_-]{1,128}. Stored ids
 * (frontmatter, casts.json, Houses) may contain dots, accents, etc. Pass the
 * sanitized value to stageForTrash; keep the real id in UndoDeleteService.
 */
export function sanitizeTrashRecordId(id: string): string {
  const sanitized = String(id ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 128);
  return sanitized.length > 0 ? sanitized : 'id';
}

/**
 * Thrown after the service has already shown the staging/rollback toast
 * (or registered Undo / sticky .ensemble-trash error). Components must not
 * toast or show a second error for this type.
 */
export class TrashStagingError extends Error {
  readonly trashStaging = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'TrashStagingError';
  }
}

export function isTrashStagingError(error: unknown): error is TrashStagingError {
  return (
    error instanceof TrashStagingError ||
    (!!error &&
      typeof error === 'object' &&
      (error as { trashStaging?: unknown }).trashStaging === true)
  );
}

/** Staging-failure / post-stage rollback toast text (exact). */
export function trashStagingFailureMessage(name: string, error: string): string {
  return `Couldn't delete "${name}": ${error}. Nothing was changed.`;
}

/** Sticky when restoreFromTrash fails after a post-stage abort and Undo cannot register. */
export function trashOrphanStickyMessage(name: string, projectPath: string): string {
  return (
    `Couldn't finish deleting "${name}" and could not restore it. ` +
    `It's kept in ${projectPath}/.ensemble-trash/. Use Undo if offered, or restore from there.`
  );
}

/** Sticky trash-commit-failed toast text (exact). */
export function trashCommitFailedMessage(
  name: string,
  error: string,
  projectPath: string
): string {
  return (
    `Couldn't move "${name}" to the system Trash (${error}). ` +
    `It's kept in ${projectPath}/.ensemble-trash/ and Ensemble will retry next time you open this project.`
  );
}

/**
 * Derive the project root from a staged path
 * (`<project>/.ensemble-trash/<entryId>/<basename>`).
 */
export function projectPathFromStagedPath(stagedPath: string): string {
  const normalized = String(stagedPath || '').replace(/\\/g, '/');
  const marker = '/.ensemble-trash/';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) {
    return normalized.slice(0, idx);
  }
  // Fallback: entry dir's parent is .ensemble-trash; its parent is the project.
  const parts = normalized.split('/');
  const trashIdx = parts.lastIndexOf('.ensemble-trash');
  if (trashIdx > 0) {
    return parts.slice(0, trashIdx).join('/');
  }
  return '';
}
