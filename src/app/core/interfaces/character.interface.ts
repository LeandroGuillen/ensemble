export interface CharacterImage {
  id: string;              // Unique ID for the image
  filename: string;        // Filename in the images/ folder (e.g., "portrait.png")
  tags: string[];          // Image tags/categories (e.g., ["portrait", "reference-art"])
  isPrimary: boolean;      // Whether this is the primary/thumbnail image
  order: number;           // Display order (0-indexed)
}

export interface Character {
  id: string;
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;      // DEPRECATED: For backward compatibility only
  images: CharacterImage[]; // Image library with tags and metadata
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
  thumbnail?: string;        // DEPRECATED: For backward compatibility only
  images: CharacterImage[];  // Image library
  mangamaster: string;
  description: string;
  notes: string;
}
