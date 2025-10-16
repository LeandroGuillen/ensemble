export interface Character {
  id: string;
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  mangamaster: string;
  description: string;
  notes: string;
  created: Date;
  modified: Date;
  filePath: string;
  folderPath: string; // Path to character's folder (characters/<category>/<slug>/)
  additionalFields: Record<string, string>; // Additional markdown files: { "Field Name": "content" }
  additionalFieldsFilenames: Record<string, string>; // Maps field names to original filenames: { "Field Name": "original-file.md" }
}

export interface CharacterFormData {
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  mangamaster: string;
  description: string;
  notes: string;
}
