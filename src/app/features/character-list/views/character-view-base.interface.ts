import { Character, Tag, Category } from '../../../core/interfaces';

export interface CharacterViewData {
  characters: Character[];
  categories: Category[];
  tags: Tag[];
  selectedCharacterId?: string | null;
  selectedCharacterIds: string[];
  thumbnailDataUrls: Map<string, string>;
}

export interface CharacterViewEvents {
  characterClick: Character;
  characterDelete: { character: Character; event: Event };
  characterSelectionToggle: string;
}