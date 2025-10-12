import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Character, CharacterFormData } from '../interfaces/character.interface';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { MarkdownUtils } from '../utils/markdown.utils';

interface CharacterFrontmatter {
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;
  created: string;
  modified: string;
}

@Injectable({
  providedIn: 'root'
})
export class CharacterService {
  private charactersSubject = new BehaviorSubject<Character[]>([]);
  public characters$ = this.charactersSubject.asObservable();
  private hasLoadedForCurrentProject = false;
  private currentProjectPath: string | null = null;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService
  ) {}

  getCharacters(): Observable<Character[]> {
    return this.characters$;
  }

  getCharacterById(id: string): Character | undefined {
    return this.charactersSubject.value.find(char => char.id === id);
  }

  /**
   * Forces a reload of characters from disk (useful for testing or external changes)
   */
  async forceReloadCharacters(): Promise<void> {
    this.hasLoadedForCurrentProject = false;
    if (this.currentProjectPath) {
      // Clear current characters before reloading
      this.charactersSubject.next([]);
      await this.loadCharacters(this.currentProjectPath);
    }
  }

  /**
   * Attempts to load a specific character file by filename (for testing)
   */
  async loadSpecificCharacterFile(filename: string): Promise<Character | null> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    try {
      const charactersPath = await this.electronService.pathJoin(this.currentProjectPath, 'characters');
      const filePath = await this.electronService.pathJoin(charactersPath, filename);
      
      const exists = await this.electronService.fileExists(filePath);
      if (!exists) {
        return null;
      }

      const character = await this.loadCharacterFromFile(filePath);
      if (character) {
        // Add to the character list if not already there
        const currentCharacters = this.charactersSubject.value;
        const exists = currentCharacters.find(c => c.id === character.id || c.filePath === character.filePath);
        
        if (!exists) {
          const updatedCharacters = [...currentCharacters, character].sort((a, b) => a.name.localeCompare(b.name));
          this.charactersSubject.next(updatedCharacters);
        }
      }
      
      return character;
    } catch (error) {
      console.error(`Failed to load specific character file ${filename}:`, error);
      return null;
    }
  }

  /**
   * Scans for existing character files more aggressively
   * This is useful when you know there are character files but they're not being detected
   */
  async scanForExistingCharacters(): Promise<number> {
    if (!this.currentProjectPath) {
      throw new Error('No project loaded');
    }

    const charactersPath = await this.electronService.pathJoin(this.currentProjectPath, 'characters');
    
    // First check if the directory exists
    const dirExists = await this.electronService.fileExists(charactersPath);
    
    if (!dirExists) {
      const createResult = await this.electronService.createDirectory(charactersPath);
      if (!createResult.success) {
        throw new Error(`Failed to create characters directory: ${createResult.error}`);
      }
      return 0;
    }

    const files = await this.getCharacterFiles(charactersPath);
    
    let loadedCount = 0;
    const characters: Character[] = [];

    for (const filename of files) {
      try {
        const filePath = await this.electronService.pathJoin(charactersPath, filename);
        const character = await this.loadCharacterFromFile(filePath);
        if (character) {
          characters.push(character);
          loadedCount++;
        }
      } catch (error) {
        console.warn(`Failed to load character file ${filename}:`, error);
      }
    }

    // Merge with existing characters (avoid duplicates)
    const existingCharacters = this.charactersSubject.value;
    const allCharacters = [...existingCharacters];

    for (const newChar of characters) {
      const exists = allCharacters.find(existing => existing.id === newChar.id || existing.filePath === newChar.filePath);
      if (!exists) {
        allCharacters.push(newChar);
      }
    }

    // Sort and update
    allCharacters.sort((a, b) => a.name.localeCompare(b.name));
    this.charactersSubject.next(allCharacters);
    
    return loadedCount;
  }

  /**
   * Loads all characters from the current project's characters directory
   */
  async loadCharacters(projectPath: string): Promise<void> {
    // If this is the same project and we've already loaded, don't reload
    if (this.currentProjectPath === projectPath && this.hasLoadedForCurrentProject) {
      return;
    }

    // If this is a different project, reset the state
    if (this.currentProjectPath !== projectPath) {
      this.currentProjectPath = projectPath;
      this.hasLoadedForCurrentProject = false;
      this.charactersSubject.next([]);
    }

    try {
      const charactersPath = await this.electronService.pathJoin(projectPath, 'characters');
      
      // Check if characters directory exists
      const dirExists = await this.electronService.fileExists(charactersPath);
      if (!dirExists) {
        // Create characters directory if it doesn't exist
        const createResult = await this.electronService.createDirectory(charactersPath);
        if (!createResult.success) {
          throw new Error(`Failed to create characters directory: ${createResult.error}`);
        }
        this.hasLoadedForCurrentProject = true;
        return;
      }

      // Get list of markdown files in characters directory
      const files = await this.getCharacterFiles(charactersPath);
      
      // If no files found, just mark as loaded
      if (files.length === 0) {
        this.hasLoadedForCurrentProject = true;
        return;
      }

      const characters: Character[] = [];

      // Load each character file
      for (const filename of files) {
        try {
          const filePath = await this.electronService.pathJoin(charactersPath, filename);
          const character = await this.loadCharacterFromFile(filePath);
          if (character) {
            characters.push(character);
          }
        } catch (error) {
          console.warn(`Failed to load character file ${filename}:`, error);
          // Continue loading other characters even if one fails
        }
      }

      // Sort characters by name and update the list
      characters.sort((a, b) => a.name.localeCompare(b.name));
      this.charactersSubject.next(characters);
      this.hasLoadedForCurrentProject = true;
    } catch (error) {
      console.error('Failed to load characters:', error);
      throw new Error(`Failed to load characters: ${error}`);
    }
  }

  /**
   * Creates a new character and saves it to disk
   */
  async createCharacter(data: CharacterFormData): Promise<Character> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    try {
      // Validate book references
      await this.validateBookReferences(data.books);

      // Generate unique ID and filename
      const id = this.generateId();
      const filename = await this.generateCharacterFilename(data.name, project.path);
      const filePath = await this.electronService.pathJoin(project.path, 'characters', filename);

      // Create character object
      const now = new Date();
      const character: Character = {
        id,
        ...data,
        created: now,
        modified: now,
        filePath
      };

      // Handle thumbnail if provided
      if (data.thumbnail) {
        character.thumbnail = await this.handleThumbnailUpload(data.thumbnail, project.path, id);
      }

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const currentCharacters = this.charactersSubject.value;
      const updatedCharacters = [...currentCharacters, character].sort((a, b) => a.name.localeCompare(b.name));
      this.charactersSubject.next(updatedCharacters);

      return character;
    } catch (error) {
      console.error('Failed to create character:', error);
      throw new Error(`Failed to create character: ${error}`);
    }
  }

  /**
   * Updates an existing character and saves changes to disk
   */
  async updateCharacter(id: string, data: Partial<CharacterFormData>): Promise<Character | null> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    try {
      // Validate book references if books are being updated
      if (data.books) {
        await this.validateBookReferences(data.books);
      }

      const characters = this.charactersSubject.value;
      const index = characters.findIndex(char => char.id === id);
      
      if (index === -1) {
        return null;
      }

      const existingCharacter = characters[index];
      
      // Handle thumbnail update
      let thumbnailPath = existingCharacter.thumbnail;
      if (data.thumbnail && data.thumbnail !== existingCharacter.thumbnail) {
        // Remove old thumbnail if it exists
        if (existingCharacter.thumbnail) {
          await this.removeThumbnail(existingCharacter.thumbnail, project.path);
        }
        // Upload new thumbnail
        thumbnailPath = await this.handleThumbnailUpload(data.thumbnail, project.path, id);
      }

      // Create updated character
      const updatedCharacter: Character = {
        ...existingCharacter,
        ...data,
        thumbnail: thumbnailPath,
        modified: new Date()
      };

      // Handle filename change if name changed
      if (data.name && data.name !== existingCharacter.name) {
        const newFilename = await this.generateCharacterFilename(data.name, project.path);
        const newFilePath = await this.electronService.pathJoin(project.path, 'characters', newFilename);
        
        // Only rename if the new filename would be different
        const currentFilename = await this.electronService.pathBasename(existingCharacter.filePath);
        if (currentFilename !== newFilename) {
          // Try to rename/move the file instead of deleting and creating new
          const oldFileExists = await this.electronService.fileExists(existingCharacter.filePath);
          if (oldFileExists) {
            try {
              // Try to copy to new location first
              const copyResult = await this.electronService.copyFile(existingCharacter.filePath, newFilePath);
              if (copyResult.success) {
                // If copy succeeded, delete the old file
                await this.deleteCharacterFile(existingCharacter.filePath);
                updatedCharacter.filePath = newFilePath;
              } else {
                console.warn('Failed to rename character file, keeping original filename:', copyResult.error);
                // Keep the original file path if rename fails
              }
            } catch (error) {
              console.warn('Failed to rename character file, keeping original filename:', error);
              // Keep the original file path if rename fails
            }
          } else {
            // File doesn't exist, use new path
            updatedCharacter.filePath = newFilePath;
          }
        }
      }

      // Save updated character to file
      await this.saveCharacterToFile(updatedCharacter);

      // Update in-memory list
      characters[index] = updatedCharacter;
      const sortedCharacters = [...characters].sort((a, b) => a.name.localeCompare(b.name));
      this.charactersSubject.next(sortedCharacters);

      return updatedCharacter;
    } catch (error) {
      console.error('Failed to update character:', error);
      throw new Error(`Failed to update character: ${error}`);
    }
  }

  /**
   * Deletes a character and removes its file from disk
   */
  async deleteCharacter(id: string): Promise<boolean> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    try {
      const characters = this.charactersSubject.value;
      const character = characters.find(char => char.id === id);
      
      if (!character) {
        return false;
      }

      // Delete character file
      const fileExists = await this.electronService.fileExists(character.filePath);
      if (fileExists) {
        await this.deleteCharacterFile(character.filePath);
      }

      // Delete thumbnail if it exists
      if (character.thumbnail) {
        await this.removeThumbnail(character.thumbnail, project.path);
      }

      // Update in-memory list
      const filteredCharacters = characters.filter(char => char.id !== id);
      this.charactersSubject.next(filteredCharacters);

      return true;
    } catch (error) {
      console.error('Failed to delete character:', error);
      throw new Error(`Failed to delete character: ${error}`);
    }
  }

  /**
   * Refreshes a single character from disk (useful for external edits)
   */
  async refreshCharacter(id: string): Promise<Character | null> {
    try {
      const characters = this.charactersSubject.value;
      const existingCharacter = characters.find(char => char.id === id);
      
      if (!existingCharacter) {
        return null;
      }

      // Check if file still exists
      const fileExists = await this.electronService.fileExists(existingCharacter.filePath);
      if (!fileExists) {
        // File was deleted externally, remove from memory
        const filteredCharacters = characters.filter(char => char.id !== id);
        this.charactersSubject.next(filteredCharacters);
        return null;
      }

      // Reload character from file
      const refreshedCharacter = await this.loadCharacterFromFile(existingCharacter.filePath);
      if (!refreshedCharacter) {
        return null;
      }

      // Update in-memory list
      const index = characters.findIndex(char => char.id === id);
      if (index !== -1) {
        characters[index] = refreshedCharacter;
        const sortedCharacters = [...characters].sort((a, b) => a.name.localeCompare(b.name));
        this.charactersSubject.next(sortedCharacters);
      }

      return refreshedCharacter;
    } catch (error) {
      console.error('Failed to refresh character:', error);
      return null;
    }
  }

  /**
   * Loads a character from a markdown file
   */
  private async loadCharacterFromFile(filePath: string): Promise<Character | null> {
    try {
      const readResult = await this.electronService.readFile(filePath);
      if (!readResult.success) {
        throw new Error(readResult.error);
      }

      const parseResult = MarkdownUtils.parseMarkdown<CharacterFrontmatter>(readResult.content!);
      if (!parseResult.success) {
        throw new Error(parseResult.error);
      }

      const { frontmatter, content } = parseResult.data!;

      // Validate required fields
      if (!frontmatter.name) {
        throw new Error('Character file missing required name field');
      }

      // Extract description and notes from content
      const sections = this.parseCharacterContent(content);

      // Generate ID from filename if not present in frontmatter
      const filename = await this.electronService.pathBasename(filePath, '.md');
      const id = this.extractIdFromFilename(filename);

      const character: Character = {
        id,
        name: frontmatter.name,
        category: frontmatter.category || '',
        tags: frontmatter.tags || [],
        books: frontmatter.books || [],
        thumbnail: frontmatter.thumbnail,
        description: sections.description,
        notes: sections.notes,
        created: frontmatter.created ? new Date(frontmatter.created) : new Date(),
        modified: frontmatter.modified ? new Date(frontmatter.modified) : new Date(),
        filePath
      };

      return character;
    } catch (error) {
      console.error(`Failed to load character from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Saves a character to a markdown file
   */
  private async saveCharacterToFile(character: Character): Promise<void> {
    try {
      const frontmatter: CharacterFrontmatter = {
        name: character.name,
        category: character.category,
        tags: character.tags,
        books: character.books,
        thumbnail: character.thumbnail,
        created: character.created.toISOString(),
        modified: character.modified.toISOString()
      };

      const content = this.generateCharacterContent(character.description, character.notes);
      const markdownContent = MarkdownUtils.generateMarkdown(frontmatter, content);

      const writeResult = await this.electronService.writeFileAtomic(character.filePath, markdownContent);
      if (!writeResult.success) {
        throw new Error(writeResult.error);
      }
    } catch (error) {
      throw new Error(`Failed to save character to ${character.filePath}: ${error}`);
    }
  }

  /**
   * Deletes a character file from disk
   */
  private async deleteCharacterFile(filePath: string): Promise<void> {
    try {
      const deleteResult = await this.electronService.deleteFile(filePath);
      if (!deleteResult.success) {
        throw new Error(deleteResult.error);
      }
    } catch (error) {
      console.warn(`File deletion not available - this requires Electron main process handlers to be implemented: ${error}`);
      // Don't throw error - file will remain on disk but character will be removed from memory
    }
  }

  /**
   * Gets list of markdown files in the characters directory
   */
  private async getCharacterFiles(charactersPath: string): Promise<string[]> {
    try {
      const listResult = await this.electronService.listDirectory(charactersPath);
      
      if (!listResult.success) {
        return [];
      }
      
      // Filter for markdown files only
      return (listResult.files || []).filter(file => file.endsWith('.md'));
    } catch (error) {
      console.error('Error getting character files:', error);
      return [];
    }
  }



  /**
   * Generates a safe filename for a character
   */
  private async generateCharacterFilename(characterName: string, projectPath: string): Promise<string> {
    const sanitized = await this.electronService.sanitizeFilename(characterName);
    const baseFilename = `${sanitized}.md`;
    
    // Check if file already exists and generate unique name if needed
    const charactersPath = await this.electronService.pathJoin(projectPath, 'characters');
    const fullPath = await this.electronService.pathJoin(charactersPath, baseFilename);
    
    const exists = await this.electronService.fileExists(fullPath);
    if (!exists) {
      return baseFilename;
    }

    // Generate unique filename
    let counter = 1;
    let uniqueFilename = baseFilename;
    
    while (true) {
      const nameWithoutExt = sanitized;
      uniqueFilename = `${nameWithoutExt}-${counter}.md`;
      const uniquePath = await this.electronService.pathJoin(charactersPath, uniqueFilename);
      const uniqueExists = await this.electronService.fileExists(uniquePath);
      
      if (!uniqueExists) {
        break;
      }
      counter++;
    }

    return uniqueFilename;
  }

  /**
   * Handles thumbnail upload and returns the filename
   */
  private async handleThumbnailUpload(thumbnailPath: string, projectPath: string, characterId: string): Promise<string> {
    try {
      // Generate unique filename for thumbnail
      const originalFilename = await this.electronService.pathBasename(thumbnailPath);
      const extension = originalFilename.split('.').pop() || 'jpg';
      const thumbnailFilename = `${characterId}.${extension}`;
      
      // Create destination path
      const thumbnailsDir = await this.electronService.pathJoin(projectPath, 'thumbnails');
      const destPath = await this.electronService.pathJoin(thumbnailsDir, thumbnailFilename);
      
      // Copy file to thumbnails directory
      const copyResult = await this.electronService.copyFile(thumbnailPath, destPath);
      if (!copyResult.success) {
        throw new Error(copyResult.error);
      }
      
      return thumbnailFilename;
    } catch (error) {
      console.warn(`Thumbnail copying not available - this requires Electron main process handlers to be implemented: ${error}`);
      // Return original path as fallback
      return thumbnailPath;
    }
  }

  /**
   * Removes a thumbnail file
   */
  private async removeThumbnail(thumbnailFilename: string, projectPath: string): Promise<void> {
    try {
      const thumbnailPath = await this.electronService.pathJoin(projectPath, 'thumbnails', thumbnailFilename);
      const exists = await this.electronService.fileExists(thumbnailPath);
      
      if (exists) {
        const deleteResult = await this.electronService.deleteFile(thumbnailPath);
        if (!deleteResult.success) {
          console.warn('Failed to delete thumbnail:', deleteResult.error);
        }
      }
    } catch (error) {
      console.warn('Thumbnail removal failed:', error);
      // Don't throw error - thumbnail will remain on disk
    }
  }

  /**
   * Parses character content into description and notes sections
   */
  private parseCharacterContent(content: string): { description: string; notes: string } {
    const lines = content.split('\n');
    let description = '';
    let notes = '';
    let currentSection = '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('## Description')) {
        currentSection = 'description';
        continue;
      } else if (trimmedLine.startsWith('## Notes')) {
        currentSection = 'notes';
        continue;
      } else if (trimmedLine.startsWith('#')) {
        // Other heading, reset section
        currentSection = '';
        continue;
      }

      if (currentSection === 'description') {
        description += line + '\n';
      } else if (currentSection === 'notes') {
        notes += line + '\n';
      }
    }

    return {
      description: description.trim(),
      notes: notes.trim()
    };
  }

  /**
   * Validates that all referenced books exist in project metadata
   */
  private async validateBookReferences(books: string[]): Promise<void> {
    if (!books || books.length === 0) {
      return; // No books to validate
    }

    // Get current project metadata to validate book references
    const project = this.projectService.getCurrentProject();
    if (!project || !project.metadata) {
      throw new Error('No project metadata available for book validation');
    }

    const availableBooks = project.metadata.books || [];
    const availableBookIds = availableBooks.map(book => book.id);

    for (const bookId of books) {
      if (!availableBookIds.includes(bookId)) {
        throw new Error(`Referenced book '${bookId}' does not exist in project metadata`);
      }
    }
  }

  /**
   * Generates character content with description and notes sections
   */
  private generateCharacterContent(description: string, notes: string): string {
    let content = '';
    
    if (description) {
      content += `## Description\n\n${description}\n\n`;
    }
    
    if (notes) {
      content += `## Notes\n\n${notes}\n`;
    }

    return content.trim();
  }

  /**
   * Extracts ID from filename (removes extension and sanitization)
   */
  private extractIdFromFilename(filename: string): string {
    // For now, use filename as ID. In a real implementation, 
    // we might want to store the ID in the frontmatter
    return filename.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}