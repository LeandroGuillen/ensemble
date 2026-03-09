import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Character, CharacterFormData, CharacterFrontmatter } from '../interfaces/character.interface';
import { Category } from '../interfaces/project.interface';
import { MarkdownUtils } from '../utils/markdown.utils';
import { slugify } from '../utils/slug.utils';
import { pathJoin, pathBasename, pathDirname } from '../utils/path.utils';
import { parseThumbnailReference, resolveThumbnailPath } from '../utils/thumbnail.utils';
import { assertIpcSuccess, withIpcError } from '../utils/ipc.utils';
import { requireProject } from '../utils/project.utils';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

@Injectable({
  providedIn: 'root',
})
export class CharacterService {
  private charactersSubject = new BehaviorSubject<Character[]>([]);
  public characters$ = this.charactersSubject.asObservable();
  private hasLoadedForCurrentProject = false;
  private currentProjectPath: string | null = null;
  
  // Persistent thumbnail cache (survives component destruction)
  private thumbnailDataUrls: Map<string, string> = new Map();
  private thumbnailModificationTimes: Map<string, string> = new Map();

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private fileWatcherService: FileWatcherService,
    private logger: LoggingService
  ) {
    // Subscribe to file changes to auto-reload characters
    this.fileWatcherService.fileChanges$.subscribe((event) => {
      this.handleFileChange(event);
    });
  }

  /**
   * Gets the folder path for a category based on its folder mode configuration.
   * @param categoryId The category ID to look up
   * @returns The subfolder name (relative to characters/), or null for flat mode
   */
  getCategoryFolderPath(categoryId: string): string | null {
    const project = this.projectService.getCurrentProject();
    if (!project?.metadata?.categories) {
      // Fallback to slugified category ID for backward compatibility
      return slugify(categoryId);
    }

    const category = project.metadata.categories.find((c) => c.id === categoryId);
    if (!category) {
      // Category not found, use slugified ID
      return slugify(categoryId);
    }

    const folderMode = category.folderMode || 'auto'; // Default to 'auto' for backward compatibility

    switch (folderMode) {
      case 'flat':
        return null; // No subfolder, characters go directly in characters/
      case 'specify':
        return category.folderPath || slugify(categoryId); // Use custom path or fallback to slug
      case 'auto':
      default:
        return slugify(categoryId); // Use category slug as folder name
    }
  }

  /**
   * Gets a Category object by its ID from project metadata
   */
  getCategoryById(categoryId: string): Category | undefined {
    const project = this.projectService.getCurrentProject();
    return project?.metadata?.categories?.find((c) => c.id === categoryId);
  }

  /**
   * Relocates all characters of a given category to their new folder locations.
   * Called when a category's folder mode or folder path changes.
   * @param categoryId The category ID whose characters should be relocated
   * @returns The number of characters relocated
   */
  async relocateCharactersForCategory(categoryId: string): Promise<number> {
    const project = requireProject(this.projectService.getCurrentProject());
    const charactersPath = this.projectService.getCharactersFolderPath();

    // Ensure characters are loaded before relocation
    if (this.charactersSubject.value.length === 0) {
      await this.forceReloadCharacters();
    }

    // Get all characters in this category
    const characters = this.charactersSubject.value.filter(
      (char) => char.category === categoryId
    );

    if (characters.length === 0) {
      return 0;
    }

    // Get the new folder path based on current category settings
    const newCategoryFolder = this.getCategoryFolderPath(categoryId);
    this.logger.log(`[relocateCharactersForCategory] New category folder: ${newCategoryFolder}`);

    let relocatedCount = 0;

    for (const character of characters) {
      try {
        const characterSlug = slugify(character.name);
        const newFilename = `_${characterSlug}.md`;

        // Determine the new file path
        let newFilePath: string;
        let newId: string;
        if (newCategoryFolder === null) {
          newFilePath = pathJoin(charactersPath, newFilename);
          newId = newFilename;
        } else {
          const categoryPath = pathJoin(charactersPath, newCategoryFolder);
          await this.electronService.createDirectory(categoryPath);
          newFilePath = pathJoin(categoryPath, newFilename);
          newId = pathJoin(newCategoryFolder, newFilename);
        }

        // Skip if already in the correct location
        if (character.filePath === newFilePath) {
          continue;
        }

        // Move the character file
        const moveResult = await this.electronService.moveDirectory(
          character.filePath,
          newFilePath
        );

        if (!moveResult.success) {
          this.logger.error(`Failed to move character ${character.name}`, moveResult.error);
          continue;
        }

        // Update the character's paths in memory
        character.id = newId;
        character.filePath = newFilePath;
        relocatedCount++;

        this.logger.log(`Relocated character ${character.name} to ${newFilePath}`);
      } catch (error) {
        this.logger.error(`Failed to relocate character ${character.name}`, error);
      }
    }

    // Update the characters subject with the modified paths
    if (relocatedCount > 0) {
      this.charactersSubject.next([...this.charactersSubject.value]);
    }

    return relocatedCount;
  }

  getCharacters(): Observable<Character[]> {
    return this.characters$;
  }

  getCharacterById(id: string): Character | undefined {
    return this.charactersSubject.value.find((char) => char.id === id);
  }

  /**
   * Returns the absolute file path for a character's book page (_<base>-<bookId>.md).
   */
  getBookPageFilePath(character: Character, bookId: string): string {
    const normalizedPath = character.filePath.replace(/\\/g, '/');
    const dir = pathDirname(normalizedPath);
    const base = pathBasename(normalizedPath, '.md');
    return pathJoin(dir, `${base}-${bookId}.md`);
  }

  /**
   * Checks if a book page file exists for the given character and book.
   */
  async bookPageExists(characterId: string, bookId: string): Promise<boolean> {
    const character = this.getCharacterById(characterId);
    if (!character) return false;
    const filePath = this.getBookPageFilePath(character, bookId);
    const result = await this.electronService.fileExists(filePath);
    return result;
  }

  /**
   * Loads the content of a character's book page. Returns null if the file does not exist.
   * Book pages are plain markdown (no frontmatter).
   */
  async getBookPageContent(characterId: string, bookId: string): Promise<string | null> {
    const character = this.getCharacterById(characterId);
    if (!character) return null;
    const filePath = this.getBookPageFilePath(character, bookId);
    const exists = await this.electronService.fileExists(filePath);
    if (!exists) return null;
    const result = await this.electronService.readFile(filePath);
    if (!result.success || result.content == null) return null;
    return result.content;
  }

  /**
   * Saves content to a character's book page file. Creates the file if it does not exist.
   */
  async saveBookPage(characterId: string, bookId: string, content: string): Promise<void> {
    const character = this.getCharacterById(characterId);
    if (!character) {
      throw new Error(`Character not found: ${characterId}`);
    }
    const filePath = this.getBookPageFilePath(character, bookId);
    const writeResult = await this.electronService.writeFileAtomic(filePath, content ?? '');
    if (!writeResult.success) {
      throw new Error(writeResult.error ?? 'Failed to save book page');
    }
  }

  /**
   * Creates a new book page file for the character with empty content.
   */
  async createBookPage(characterId: string, bookId: string): Promise<void> {
    await this.saveBookPage(characterId, bookId, '');
  }

  /**
   * Forces a reload of characters from disk (useful for testing or external changes)
   */
  async forceReloadCharacters(): Promise<void> {
    this.hasLoadedForCurrentProject = false;
    
    // Get project path from current state or from projectService
    let projectPath = this.currentProjectPath;
    if (!projectPath) {
      const project = this.projectService.getCurrentProject();
      projectPath = project?.path || null;
      this.currentProjectPath = projectPath;
    }
    
    if (projectPath) {
      // Clear current characters before reloading
      this.charactersSubject.next([]);
      await this.loadCharacters(projectPath);
    }
  }

  /**
   * Attempts to load a specific character file by filename (for testing)
   * @deprecated Legacy method - use forceReloadCharacters instead
   */
  async loadSpecificCharacterFile(filename: string): Promise<Character | null> {
    console.warn('loadSpecificCharacterFile is deprecated - use forceReloadCharacters instead');
    await this.forceReloadCharacters();
    return null;
  }

  /**
   * Scans for existing character files more aggressively
   * @deprecated Legacy method - use forceReloadCharacters instead
   */
  async scanForExistingCharacters(): Promise<number> {
    console.warn('scanForExistingCharacters is deprecated - use forceReloadCharacters instead');
    await this.forceReloadCharacters();
    return this.charactersSubject.value.length;
  }

  /**
   * Loads all characters from the current project's characters directory
   * Supports mixed folder structures based on category folder modes:
   * - Flat mode: characters/<character-slug>/ (folder contains .md file directly)
   * - Auto/Specify mode: characters/<category-folder>/<character-slug>/
   */
  async loadCharacters(projectPath: string): Promise<void> {
    // If this is the same project and we've already loaded, don't reload
    if (this.currentProjectPath === projectPath && this.hasLoadedForCurrentProject) {
      return;
    }

    // If this is a different project, reset the state and clear thumbnail cache
    if (this.currentProjectPath !== projectPath) {
      this.currentProjectPath = projectPath;
      this.hasLoadedForCurrentProject = false;
      this.charactersSubject.next([]);
      // Clear thumbnail cache when switching projects
      this.thumbnailDataUrls.clear();
      this.thumbnailModificationTimes.clear();
    }

    try {
      const charactersPath = this.projectService.getCharactersFolderPath();

      // Check if characters directory exists
      const dirExists = await this.electronService.fileExists(charactersPath);
      if (!dirExists) {
        // Create characters directory if it doesn't exist
        assertIpcSuccess(
          await this.electronService.createDirectory(charactersPath),
          'Create characters directory'
        );
        this.hasLoadedForCurrentProject = true;
        return;
      }

      // Recursively scan for _*.md files
      const scanResult = await this.electronService.readDirectoryRecursive(charactersPath, '_*.md');
      if (!scanResult.success || !scanResult.files) {
        this.hasLoadedForCurrentProject = true;
        return;
      }

      // Exclude book-page files (_<base>-<bookId>.md) so they are not treated as characters
      const project = this.projectService.getCurrentProject();
      const bookIds = new Set((project?.metadata?.books ?? []).map((b) => b.id));

      const characters: Character[] = [];

      for (const { relativePath, absolutePath } of scanResult.files) {
        try {
          const base = pathBasename(relativePath, '.md');
          const lastDash = base.lastIndexOf('-');
          if (lastDash !== -1) {
            const suffix = base.slice(lastDash + 1);
            if (bookIds.has(suffix)) {
              continue; // Book page file, skip
            }
          }
          const character = await this.loadCharacterFromFile(absolutePath, relativePath);
          if (character) {
            characters.push(character);
          }
        } catch (error) {
          this.logger.error(`Failed to load character from ${relativePath}:`, error);
        }
      }

      // Sort characters by name and update the list
      characters.sort((a, b) => a.name.localeCompare(b.name));
      this.charactersSubject.next(characters);
      this.hasLoadedForCurrentProject = true;
    } catch (error) {
      this.logger.error('Failed to load characters', error);
      throw new Error(`Failed to load characters: ${error}`);
    }
  }

  /**
   * Loads a character from a single _*.md file
   */
  private async loadCharacterFromFile(absolutePath: string, relativePath: string): Promise<Character | null> {
    try {
      const readResult = await this.electronService.readFile(absolutePath);
      if (!readResult.success) {
        this.logger.error(`Failed to read character file ${absolutePath}:`, readResult.error);
        return null;
      }

      const parseResult = MarkdownUtils.parseMarkdown<CharacterFrontmatter>(readResult.content!);
      if (!parseResult.success) {
        this.logger.error(`Failed to parse character file ${absolutePath}:`, parseResult.error);
        return null;
      }

      const { frontmatter, content } = parseResult.data!;

      // Validate required fields
      if (!frontmatter.name) {
        this.logger.error(`Character file missing required name field: ${absolutePath}`);
        return null;
      }

      const character: Character = {
        id: relativePath,
        name: frontmatter.name,
        category: frontmatter.category || 'uncategorized',
        tags: frontmatter.tags || [],
        books: frontmatter.books || [],
        thumbnail: frontmatter.thumbnail,
        content: content || '',
        created: frontmatter.created ? new Date(frontmatter.created) : new Date(),
        modified: frontmatter.modified ? new Date(frontmatter.modified) : new Date(),
        filePath: absolutePath,
      };

      return character;
    } catch (error) {
      this.logger.error(`Failed to load character from ${absolutePath}`, error);
      return null;
    }
  }

  /**
   * Creates a new character and saves it to disk as _<slug>.md
   * File location depends on category folder mode
   */
  async createCharacter(data: CharacterFormData): Promise<Character> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      // Validate book references
      await this.validateBookReferences(data.books);

      const slug = slugify(data.name);
      const filename = `_${slug}.md`;

      // Get category folder path based on folder mode
      const categoryFolderPath = this.getCategoryFolderPath(data.category);

      let filePath: string;
      let relativePath: string;
      const charactersPath = this.projectService.getCharactersFolderPath();
      if (categoryFolderPath === null) {
        filePath = pathJoin(charactersPath, filename);
        relativePath = filename;
      } else {
        const categoryPath = pathJoin(charactersPath, categoryFolderPath);
        assertIpcSuccess(
          await this.electronService.createDirectory(categoryPath),
          'Create category directory'
        );
        filePath = pathJoin(categoryPath, filename);
        relativePath = pathJoin(categoryFolderPath, filename);
      }

      const now = new Date();
      const character: Character = {
        id: relativePath,
        name: data.name,
        category: data.category,
        tags: data.tags || [],
        books: data.books || [],
        thumbnail: data.thumbnail,
        content: data.content || '',
        created: now,
        modified: now,
        filePath,
      };

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const currentCharacters = this.charactersSubject.value;
      const updatedCharacters = [...currentCharacters, character].sort((a, b) => a.name.localeCompare(b.name));
      this.charactersSubject.next(updatedCharacters);

      return character;
    } catch (error) {
      this.logger.error('Failed to create character', error);
      throw new Error(`Failed to create character: ${error}`);
    }
  }

  /**
   * Updates an existing character and saves changes to disk
   * Handles file move/rename when category or name changes
   */
  async updateCharacter(
    id: string,
    data: Partial<CharacterFormData>
  ): Promise<Character | null> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      // Validate book references if books are being updated
      if (data.books) {
        await this.validateBookReferences(data.books);
      }

      const characters = this.charactersSubject.value;
      const index = characters.findIndex((char) => char.id === id);

      if (index === -1) {
        return null;
      }

      const existingCharacter = characters[index];
      let newFilePath = existingCharacter.filePath;
      let newId = id;

      // Check if we need to move/rename the file (category or name changed)
      const categoryChanged = data.category && data.category !== existingCharacter.category;
      const nameChanged = data.name && data.name !== existingCharacter.name;

      if (categoryChanged || nameChanged) {
        const newName = data.name || existingCharacter.name;
        const newCategory = data.category || existingCharacter.category;
        const newSlug = slugify(newName);
        const newFilename = `_${newSlug}.md`;

        // Get category folder path based on folder mode
        const categoryFolderPath = this.getCategoryFolderPath(newCategory);

        let destFilePath: string;
        const charactersPath = this.projectService.getCharactersFolderPath();
        if (categoryFolderPath === null) {
          destFilePath = pathJoin(charactersPath, newFilename);
          newId = newFilename;
        } else {
          const newCategoryPath = pathJoin(charactersPath, categoryFolderPath);
          await this.electronService.createDirectory(newCategoryPath);
          destFilePath = pathJoin(newCategoryPath, newFilename);
          newId = pathJoin(categoryFolderPath, newFilename);
        }

        // Move/rename the file (fs.rename works for files)
        const moveResult = await this.electronService.moveDirectory(existingCharacter.filePath, destFilePath);
        if (!moveResult.success) {
          throw new Error(`Failed to move character file: ${moveResult.error}`);
        }

        newFilePath = destFilePath;
      }

      // Create updated character
      const updatedCharacter: Character = {
        ...existingCharacter,
        id: newId,
        name: data.name ?? existingCharacter.name,
        category: data.category ?? existingCharacter.category,
        tags: data.tags ?? existingCharacter.tags,
        books: data.books ?? existingCharacter.books,
        thumbnail: data.thumbnail !== undefined ? data.thumbnail : existingCharacter.thumbnail,
        content: data.content !== undefined ? data.content : existingCharacter.content,
        modified: new Date(),
        filePath: newFilePath,
      };

      // Save updated character to file
      await this.saveCharacterToFile(updatedCharacter);

      // Update in-memory list
      characters[index] = updatedCharacter;
      const sortedCharacters = [...characters].sort((a, b) => a.name.localeCompare(b.name));
      this.charactersSubject.next(sortedCharacters);

      return updatedCharacter;
    } catch (error) {
      this.logger.error('Failed to update character', error);
      throw new Error(`Failed to update character: ${error}`);
    }
  }

  /**
   * Permanently deletes a character file
   */
  async deleteCharacter(id: string): Promise<boolean> {
    try {
      const characters = this.charactersSubject.value;
      const character = characters.find((char) => char.id === id);

      if (!character) {
        return false;
      }

      const deleteResult = await this.electronService.deleteFile(character.filePath);
      if (!deleteResult.success) {
        throw new Error(`Failed to delete character: ${deleteResult.error}`);
      }

      // Update in-memory list
      const filteredCharacters = characters.filter((char) => char.id !== id);
      this.charactersSubject.next(filteredCharacters);

      return true;
    } catch (error) {
      this.logger.error('Failed to delete character', error);
      throw new Error(`Failed to delete character: ${error}`);
    }
  }

  /**
   * Refreshes a single character from disk (useful for external edits)
   */
  async refreshCharacter(id: string): Promise<Character | null> {
    try {
      const characters = this.charactersSubject.value;
      const existingCharacter = characters.find((char) => char.id === id);

      if (!existingCharacter) {
        return null;
      }

      // Check if file still exists
      const fileExists = await this.electronService.fileExists(existingCharacter.filePath);
      if (!fileExists) {
        // File was deleted externally, remove from memory
        const filteredCharacters = characters.filter((char) => char.id !== id);
        this.charactersSubject.next(filteredCharacters);
        return null;
      }

      // Reload character from file
      const refreshedCharacter = await this.loadCharacterFromFile(
        existingCharacter.filePath,
        existingCharacter.id
      );
      if (!refreshedCharacter) {
        return null;
      }

      // Update in-memory list
      const index = characters.findIndex((char) => char.id === id);
      if (index !== -1) {
        characters[index] = refreshedCharacter;
        const sortedCharacters = [...characters].sort((a, b) => a.name.localeCompare(b.name));
        this.charactersSubject.next(sortedCharacters);
      }

      return refreshedCharacter;
    } catch (error) {
      this.logger.error('Failed to refresh character', error);
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
        modified: character.modified.toISOString(),
      };

      const markdownContent = MarkdownUtils.generateMarkdown(frontmatter, character.content);

      const writeResult = await this.electronService.writeFileAtomic(character.filePath, markdownContent);
      if (!writeResult.success) {
        throw new Error(writeResult.error);
      }
    } catch (error) {
      throw new Error(`Failed to save character to ${character.filePath}: ${error}`);
    }
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
    const availableBookIds = availableBooks.map((book) => book.id);

    for (const bookId of books) {
      if (!availableBookIds.includes(bookId)) {
        throw new Error(`Referenced book '${bookId}' does not exist in project metadata`);
      }
    }
  }

  /**
   * Handles file change events from the file watcher
   */
  private async handleFileChange(event: { type: string; path: string; filename: string }): Promise<void> {
    this.logger.log('File change detected:', event);

    if (!this.currentProjectPath) {
      return;
    }

    if (!event.filename.endsWith('.md') || !event.filename.startsWith('_')) {
      return;
    }

    try {
      const charactersPath = this.projectService.getCharactersFolderPath();
      if (!event.path.startsWith(charactersPath)) {
        return;
      }

      const characters = this.charactersSubject.value;
      const character = characters.find((char) => char.filePath === event.path);

      if (event.type === 'unlink') {
        if (character) {
          const filteredCharacters = characters.filter((char) => char.filePath !== event.path);
          this.charactersSubject.next(filteredCharacters);
          this.logger.log(`Character removed: ${character.name}`);
        }
      } else if (event.type === 'change' || event.type === 'add') {
        if (character) {
          await this.refreshCharacter(character.id);
          this.logger.log(`Character reloaded: ${character.name}`);
        } else {
          await this.forceReloadCharacters();
          this.logger.log('Characters reloaded due to new file');
        }
      }
    } catch (error) {
      this.logger.error('Error handling file change', error);
    }
  }

  getCachedThumbnail(characterId: string): string | null {
    return this.thumbnailDataUrls.get(characterId) || null;
  }

  /**
   * Loads a character's thumbnail from img/ folder and caches it.
   * Resolves Obsidian wiki-link format [[img/path.png]] or plain paths.
   */
  async loadThumbnailForCharacter(character: Character): Promise<string | null> {
    if (!character.thumbnail) {
      return null;
    }
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return null;
    }
    const parsed = parseThumbnailReference(character.thumbnail);
    if (!parsed) {
      return null;
    }
    const absolutePath = resolveThumbnailPath(project.path, parsed);
    try {
      const dataUrl = await this.electronService.getImageAsDataUrl(absolutePath);
      if (dataUrl) {
        const modTime = character.modified?.toISOString() ?? '';
        this.setCachedThumbnail(character.id, dataUrl, modTime);
        return dataUrl;
      }
    } catch (error) {
      this.logger.error(`Failed to load thumbnail for character ${character.name}:`, error);
    }
    return null;
  }

  /**
   * Batch loads thumbnails for characters that have thumbnail references.
   */
  async loadThumbnailsForCharacters(characters: Character[]): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return;
    }
    const toLoad = characters.filter(
      (c) => c.thumbnail && !this.thumbnailDataUrls.has(c.id)
    );
    await Promise.all(
      toLoad.map((char) => this.loadThumbnailForCharacter(char))
    );
  }

  setCachedThumbnail(characterId: string, dataUrl: string, modificationTime: string): void {
    this.thumbnailDataUrls.set(characterId, dataUrl);
    this.thumbnailModificationTimes.set(characterId, modificationTime);
  }

  getCachedThumbnailModTime(characterId: string): string | null {
    return this.thumbnailModificationTimes.get(characterId) || null;
  }

  removeCachedThumbnail(characterId: string): void {
    this.thumbnailDataUrls.delete(characterId);
    this.thumbnailModificationTimes.delete(characterId);
  }

  /**
   * @deprecated Images library removed - returns null
   */
  getCachedCharacterImages(characterId: string): string[] | null {
    return null;
  }

  /**
   * @deprecated Images library removed - no-op
   */
  setCachedCharacterImages(characterId: string, imageUrls: string[]): void {
    // No-op
  }

  /**
   * @deprecated Images library removed - no-op
   */
  async reorderImages(_characterId: string, _imageIds: string[]): Promise<void> {
    // No-op
  }

  /**
   * @deprecated Images library removed - returns null
   */
  async getImagePath(_characterId: string, _imageId: string): Promise<string | null> {
    return null;
  }

  /**
   * @deprecated Images library removed - returns null
   */
  getPrimaryImage(_character: Character): null {
    return null;
  }

  /**
   * @deprecated Images library removed - no-op
   */
  private async handleImageFileChange(_event: { type: string; path: string; filename: string }): Promise<void> {
    // No-op
  }

  /**
   * Gets all cached thumbnail data URLs (for passing to child components)
   */
  getAllCachedThumbnails(): Map<string, string> {
    return new Map(this.thumbnailDataUrls);
  }

}
