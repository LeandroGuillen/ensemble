import { buildDeleteReferencesMessage } from '../../shared/utils/reference-message.utils';

export interface CharacterDeleteMessageDeps {
  characterService: {
    countCharacterReferences(id: string): Promise<{
      houses: { id: string; name: string }[];
      casts: { id: string; name: string }[];
      pinboards: { id: string; name: string }[];
      plotBoards: { id: string; name: string }[];
    }>;
  };
  logger: {
    error(message: string, error: any): void;
  };
}

/**
 * Build the delete confirmation message for a character.
 * If counting references fails, logs the error and returns the base message.
 */
export async function buildCharacterDeleteMessage(
  characterName: string,
  characterId: string,
  isDraft: boolean,
  deps: CharacterDeleteMessageDeps
): Promise<string> {
  let confirmMessage = `Are you sure you want to delete "${characterName || 'Unnamed draft'}"?`;

  if (!isDraft) {
    try {
      const refs = await deps.characterService.countCharacterReferences(characterId);
      confirmMessage += buildDeleteReferencesMessage(refs);
    } catch (error) {
      deps.logger.error('Failed to count character references', error);
    }
  }

  confirmMessage += '\n\nThis action cannot be undone.';
  return confirmMessage;
}
