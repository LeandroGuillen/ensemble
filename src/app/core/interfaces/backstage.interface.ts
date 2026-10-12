export interface CharacterConcept {
  title?: string;
  notes: string;
}

export interface NameWithNotes {
  name: string;
  notes?: string;
}

export interface NameList {
  title: string;
  description?: string;
  names: NameWithNotes[];
}

export interface BackstageData {
  concepts: CharacterConcept[];
  nameLists: NameList[];
}
