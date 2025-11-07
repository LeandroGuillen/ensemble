export interface CharacterConcept {
  title?: string;
  notes: string;
}

export interface NameList {
  title: string;
  names: string[];
}

export interface BackstageData {
  concepts: CharacterConcept[];
  nameLists: NameList[];
}
