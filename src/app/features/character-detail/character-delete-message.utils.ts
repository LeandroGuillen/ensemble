import { buildDeleteReferencesMessage } from '../../shared/utils/reference-message.utils';

export interface CharacterDeleteMessageDeps {
  characterService: {
    countCharacterReferences(id: string): Promise<{
      houses: { id: string; name: string }[];
      casts: { id: string; name: string }[];
      pinboards: { id: string; name: string }[];
      plotBoards: { id: string; name: string }[];
      prompts?: { id: string; name: string }[];
    }>;
  };
  logger: {
    error(message: string, error: any): void;
  };
}

/** Closing note of every character / draft / Lore delete dialog. */
export const CHARACTER_DELETE_TRASH_NOTE =
  '\n\nIt will be moved to the system Trash. You can undo for 15 seconds. After that, restore it from the system Trash (links in Houses, pinboards, plot threads and prompts come back only with Undo).';

/**
 * Build the delete confirmation message for a character (or draft).
 * Drafts are only linked from prompts, so their list holds just prompts.
 * If counting references fails, logs the error and returns the base message.
 */
export async function buildCharacterDeleteMessage(
  characterName: string,
  characterId: string,
  isDraft: boolean,
  deps: CharacterDeleteMessageDeps
): Promise<string> {
  let confirmMessage = `Are you sure you want to delete "${characterName || 'Unnamed draft'}"?`;

  try {
    const refs = await deps.characterService.countCharacterReferences(characterId);
    confirmMessage += buildDeleteReferencesMessage(refs, isDraft ? 'draft' : 'character');
  } catch (error) {
    deps.logger.error('Failed to count character references', error);
  }

  return confirmMessage + CHARACTER_DELETE_TRASH_NOTE;
}
