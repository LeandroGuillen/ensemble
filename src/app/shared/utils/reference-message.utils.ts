/**
 * Format a list of referenced items for display in delete confirmation dialogs.
 * @param items Array of {id, name} items
 * @param singularLabel Label for single item (e.g. 'house')
 * @param pluralLabel Label for multiple items (e.g. 'houses')
 * @param maxShow Maximum number of names to show before truncating (default: 3)
 * @returns Formatted string like "2 houses: Vell, Dunmore" or "5 houses: Vell, Dunmore, Hale +2 more"
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

type ReferenceList = { id: string; name: string }[];

/**
 * Build the full delete confirmation message listing all referenced resources.
 * @param refs Arrays of referenced houses, casts, pinboards, plot boards and prompts (all optional)
 * @param subject What is being deleted, for the heading (default: 'character')
 * @returns Message fragment (e.g. '\n\nThis character will be removed from:\n• ...')
 *          or empty string if no references exist
 */
export function buildDeleteReferencesMessage(
  refs: {
    houses?: ReferenceList;
    casts?: ReferenceList;
    pinboards?: ReferenceList;
    plotBoards?: ReferenceList;
    prompts?: ReferenceList;
  },
  subject: string = 'character'
): string {
  const refParts: string[] = [];
  const add = (items: ReferenceList | undefined, singular: string, plural: string) => {
    if (items && items.length > 0) refParts.push(formatReferenceList(items, singular, plural));
  };

  add(refs.houses, 'house', 'houses');
  add(refs.casts, 'cast', 'casts');
  add(refs.pinboards, 'pinboard', 'pinboards');
  add(refs.plotBoards, 'plot board', 'plot boards');
  add(refs.prompts, 'prompt', 'prompts');

  if (refParts.length === 0) return '';

  return `\n\nThis ${subject} will be removed from:\n• ${refParts.join('\n• ')}`;
}
