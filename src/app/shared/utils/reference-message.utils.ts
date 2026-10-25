/**
 * Format a list of referenced items for display in delete confirmation dialogs.
 * @param items Array of {id, name} items
 * @param singularLabel Label for single item (e.g. 'house')
 * @param pluralLabel Label for multiple items (e.g. 'houses')
 * @param maxShow Maximum number of names to show before truncating (default: 3)
 * @returns Formatted string like "2 houses: Stark, Tully" or "5 houses: Stark, Tully, Lannister +2 more"
 */
export function formatReferenceList(
  items: { id: string; name: string }[],
  singularLabel: string,
  pluralLabel: string,
  maxShow: number = 3
): string {
  if (items.length === 0) return '';
  const count = items.length;
  const names = items.slice(0, maxShow).map(item => item.name).join(', ');
  const more = count > maxShow ? ` +${count - maxShow} more` : '';
  const label = count === 1 ? singularLabel : pluralLabel;
  return `${count} ${label}: ${names}${more}`;
}

/**
 * Build the full delete confirmation message listing all referenced resources.
 * @param refs Object containing arrays of referenced houses, casts, pinboards, and plotBoards
 * @returns Message fragment (e.g. '\n\nThis character will be removed from:\n• ...')
 *          or empty string if no references exist
 */
export function buildDeleteReferencesMessage(refs: {
  houses: { id: string; name: string }[];
  casts: { id: string; name: string }[];
  pinboards: { id: string; name: string }[];
  plotBoards: { id: string; name: string }[];
}): string {
  const refParts: string[] = [];
  
  if (refs.houses.length > 0) refParts.push(formatReferenceList(refs.houses, 'house', 'houses'));
  if (refs.casts.length > 0) refParts.push(formatReferenceList(refs.casts, 'cast', 'casts'));
  if (refs.pinboards.length > 0) refParts.push(formatReferenceList(refs.pinboards, 'pinboard', 'pinboards'));
  if (refs.plotBoards.length > 0) refParts.push(formatReferenceList(refs.plotBoards, 'plot board', 'plot boards'));
  
  if (refParts.length === 0) return '';
  
  return `\n\nThis character will be removed from:\n• ${refParts.join('\n• ')}`;
}
