/**
 * Resolves the effective category for a character in an optional book context.
 * When `bookId` is set and an override exists, that override wins; otherwise the
 * character's default `category` is used.
 */
export function resolveEffectiveCategory(
  character: { category: string; bookCategories?: Record<string, string> },
  bookId?: string | null
): string {
  if (bookId && character.bookCategories?.[bookId]) {
    return character.bookCategories[bookId];
  }
  return character.category;
}

/**
 * Whether a character's effective category is enabled in the character list.
 * Categories missing from project metadata remain visible so stale character
 * data cannot disappear without a corresponding sidebar control.
 */
export function isEffectiveCategoryEnabled(
  character: { category: string; bookCategories?: Record<string, string> },
  bookId: string | null | undefined,
  knownCategoryIds: readonly string[],
  enabledCategoryIds: readonly string[]
): boolean {
  const effectiveCategory = resolveEffectiveCategory(character, bookId);
  return (
    !knownCategoryIds.includes(effectiveCategory) ||
    enabledCategoryIds.includes(effectiveCategory)
  );
}

/**
 * Coerces a raw frontmatter `bookCategories` value into a clean map.
 * Optionally prunes entries whose book id is not in `assignedBookIds`.
 * Returns undefined when the result is empty.
 */
export function normalizeBookCategories(
  raw: unknown,
  assignedBookIds?: string[]
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const assigned =
    assignedBookIds === undefined ? null : new Set(assignedBookIds);
  const result: Record<string, string> = {};

  for (const [bookId, categoryId] of Object.entries(raw as Record<string, unknown>)) {
    if (!bookId || typeof categoryId !== 'string') continue;
    const trimmed = categoryId.trim();
    if (!trimmed) continue;
    if (assigned && !assigned.has(bookId)) continue;
    result[bookId] = trimmed;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
