import { Character, Tag, Category } from '../../../core/interfaces';

export interface CharacterViewData {
  characters: Character[];
  categories: Category[];
  tags: Tag[];
  /** Flat keyboard-nav index of the highlighted occurrence (-1 = none). */
  selectedNavIndex?: number;
  /** Global nav-index offset for the first card in this view instance. */
  navIndexOffset?: number;
  selectedCharacterIds: string[];
  thumbnailDataUrls: Map<string, string>;
}

export interface CharacterViewEvents {
  characterClick: Character;
  characterDelete: { character: Character; event: Event };
  characterSelectionToggle: string;
}