export interface Character {
  id: string;
  name: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  mangamaster: string;
  description: string;
  notes: string;
  created: Date;
  modified: Date;
  filePath: string;
}

export interface CharacterFormData {
  name: string;
  category: string;
  tags: string[];
  thumbnail?: string;
  mangamaster: string;
  description: string;
  notes: string;
}