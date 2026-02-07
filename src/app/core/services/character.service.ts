import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Character, CharacterFormData, CharacterImage } from '../interfaces/character.interface';
import { Category } from '../interfaces/project.interface';
import { MarkdownUtils } from '../utils/markdown.utils';
import { filenameToFieldName, slugify, slugifyWithTimestamp } from '../utils/slug.utils';
import { generateId } from '../utils/id.utils';
import { pathJoin, pathBasename, pathDirname } from '../utils/path.utils';
import { assertIpcSuccess, withIpcError } from '../utils/ipc.utils';
import { requireProject } from '../utils/project.utils';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

interface CharacterFrontmatter {
  id?: string; // Character ID for consistent identification
  name: string;
  category: string;
  tags: string[];
  books: string[];
  thumbnail?: string;  // DEPRECATED: For backward compatibility only
  images?: CharacterImage[]; // New image library with tags and metadata
  mangamaster: string;
  created: string;
  modified: string;
}

@Injectable({
  providedIn: 'root',
})
export class CharacterService {
  private charactersSubject = new BehaviorSubject<Character[]>([]);
  public characters$ = this.charactersSubject.asObservable();
  private hasLoadedForCurrentProject = false;
  private currentProjectPath: string | null = null;

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
    const charactersPath = pathJoin(project.path, 'characters');

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

        // Determine the new folder path
        let newFolderPath: string;
        if (newCategoryFolder === null) {
          // Flat mode: characters/<slug>/
          newFolderPath = pathJoin(charactersPath, characterSlug);
        } else {
          // Auto or Specify mode: characters/<category-folder>/<slug>/
          const categoryPath = pathJoin(charactersPath, newCategoryFolder);
          newFolderPath = pathJoin(categoryPath, characterSlug);

          // Ensure category folder exists
          await this.electronService.createDirectory(categoryPath);
        }

        // Skip if already in the correct location
        if (character.folderPath === newFolderPath) {
          continue;
        }

        // Move the character folder
        const moveResult = await this.electronService.moveDirectory(
          character.folderPath,
          newFolderPath
        );

        if (!moveResult.success) {
          this.logger.error(`Failed to move character ${character.name}`, moveResult.error);
          continue;
        }

        // Update the character's paths in memory
        const newFilePath = pathJoin(newFolderPath, `${characterSlug}.md`);
        character.folderPath = newFolderPath;
        character.filePath = newFilePath;
        relocatedCount++;

        this.logger.log(`Relocated character ${character.name} to ${newFolderPath}`);
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

    // If this is a different project, reset the state
    if (this.currentProjectPath !== projectPath) {
      this.currentProjectPath = projectPath;
      this.hasLoadedForCurrentProject = false;
      this.charactersSubject.next([]);
    }

    try {
      const charactersPath = pathJoin(projectPath, 'characters');

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

      // Read all folders under characters/
      const dirContents = await this.electronService.readDirectoryFiles(charactersPath);
      if (!dirContents.success || !dirContents.directories) {
        this.hasLoadedForCurrentProject = true;
        return;
      }

      const characters: Character[] = [];

      // Iterate through all folders under characters/
      for (const folderName of dirContents.directories) {
        const folderPath = pathJoin(charactersPath, folderName);

        // Skip _deleted folder - it contains deleted characters and should not be loaded
        if (folderName === '_deleted') {
          continue;
        }

        // Folders starting with underscore are always treated as category folders, never as characters
        // This allows _other, _supporting etc. to contain characters without being treated as characters themselves
        const isUnderscoreFolder = folderName.startsWith('_');

        // Determine if this is a character folder (flat mode) or a category folder
        // Underscore folders are never character folders, only category folders
        const isCharacterFolder = !isUnderscoreFolder && await this.isCharacterFolder(folderPath, folderName);

        if (isCharacterFolder) {
          // Flat mode: This folder IS a character folder
          try {
            const character = await this.loadCharacterFromFolder(folderPath, '', folderName);
            if (character) {
              characters.push(character);
            }
          } catch (error) {
            this.logger.error(`Failed to load character from ${folderName}:`, error);
          }
        } else {
          // This is a category folder - scan for character subfolders (recursively handles nested categories)
          const categoryCharacters = await this.loadCharactersFromCategory(folderPath, folderName);
          characters.push(...categoryCharacters);
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
   * Checks if a folder is a character folder (flat mode) or a category folder
   * A character folder contains a <slug>.md file directly
   */
  private async isCharacterFolder(folderPath: string, folderSlug: string): Promise<boolean> {
    try {
      // Check if the folder contains a <slug>.md file
      const expectedMdFile = `${folderSlug}.md`;
      const mdFilePath = pathJoin(folderPath, expectedMdFile);
      const exists = await this.electronService.fileExists(mdFilePath);
      return exists;
    } catch {
      return false;
    }
  }

  /**
   * Recursively loads characters from a category folder.
   * Handles nested categories (e.g., _other/_unnamed/character-name).
   * Underscore-prefixed folders are treated as sub-categories, not characters.
   */
  private async loadCharactersFromCategory(categoryPath: string, categorySlug: string): Promise<Character[]> {
    const characters: Character[] = [];

    const categoryContents = await this.electronService.readDirectoryFiles(categoryPath);
    if (!categoryContents.success || !categoryContents.directories) {
      return characters;
    }

    for (const subfolderName of categoryContents.directories) {
      const subfolderPath = pathJoin(categoryPath, subfolderName);

      // Skip _deleted folder - it contains deleted characters and should not be loaded
      if (subfolderName === '_deleted') {
        continue;
      }

      // Underscore folders are always sub-categories, never characters
      const isUnderscoreFolder = subfolderName.startsWith('_');

      if (isUnderscoreFolder) {
        // Recursively scan underscore folders as sub-categories
        const subCategoryCharacters = await this.loadCharactersFromCategory(subfolderPath, categorySlug);
        characters.push(...subCategoryCharacters);
      } else {
        // Try to load as a character folder
        try {
          const character = await this.loadCharacterFromFolder(subfolderPath, categorySlug, subfolderName);
          if (character) {
            characters.push(character);
          }
        } catch (error) {
          this.logger.error(`Failed to load character from ${categorySlug}/${subfolderName}:`, error);
        }
      }
    }

    return characters;
  }

  /**
   * Creates a new character and saves it to disk
   * Structure depends on category folder mode:
   * - flat: characters/<character-slug>/
   * - auto: characters/<category-slug>/<character-slug>/
   * - specify: characters/<custom-folder>/<character-slug>/
   */
  async createCharacter(data: CharacterFormData): Promise<Character> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      // Validate book references
      await this.validateBookReferences(data.books);

      // Generate unique ID and slug
      const id = generateId();
      const slug = slugify(data.name);

      // Get category folder path based on folder mode
      const categoryFolderPath = this.getCategoryFolderPath(data.category);

      // Create folder structure based on folder mode
      let characterFolderPath: string;
      if (categoryFolderPath === null) {
        // Flat mode: characters/<slug>/
        characterFolderPath = pathJoin(project.path, 'characters', slug);
      } else {
        // Auto or Specify mode: characters/<category-folder>/<slug>/
        const categoryPath = pathJoin(project.path, 'characters', categoryFolderPath);
        characterFolderPath = pathJoin(categoryPath, slug);

        // Ensure category folder exists
        assertIpcSuccess(
          await this.electronService.createDirectory(categoryPath),
          'Create category directory'
        );
      }

      // Create character folder
      assertIpcSuccess(
        await this.electronService.createDirectory(characterFolderPath),
        'Create character directory'
      );

      // Main character file path
      const filePath = pathJoin(characterFolderPath, `${slug}.md`);

      // Create character object
      const now = new Date();
      const character: Character = {
        id,
        ...data,
        mangamaster: data.mangamaster || '',
        images: data.images || [], // Initialize with provided images or empty array
        created: now,
        modified: now,
        filePath,
        folderPath: characterFolderPath,
        additionalFields: {},
        additionalFieldsFilenames: {},
      };

      // Handle thumbnail if provided - copy to character folder (backward compatibility)
      if (data.thumbnail) {
        character.thumbnail = await this.handleThumbnailUploadToFolder(data.thumbnail, characterFolderPath);
      }

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
   * Saves additional fields to the character folder
   * Uses original filenames from additionalFieldsFilenames mapping
   */
  async saveAdditionalFields(characterId: string, additionalFields: Record<string, string>): Promise<void> {
    const characters = this.charactersSubject.value;
    const character = characters.find((char) => char.id === characterId);

    if (!character) {
      throw new Error('Character not found');
    }

    for (const [fieldName, content] of Object.entries(additionalFields)) {
      // Use the original filename if available, otherwise create a new one
      const filename: string =
        character.additionalFieldsFilenames[fieldName] || fieldName.toLowerCase().replace(/\s+/g, '-') + '.md';
      const filePath = pathJoin(character.folderPath, filename);

      // Write the file
      assertIpcSuccess(
        await this.electronService.writeFileAtomic(filePath, content),
        `Save ${filename}`
      );
    }

    // Reload the character to update additionalFields in memory
    await this.refreshCharacter(characterId);
  }

  /**
   * Updates an existing character and saves changes to disk
   * Handles folder moves when category or name changes
   */
  async updateCharacter(
    id: string,
    data: Partial<CharacterFormData>,
    additionalFieldsChanges?: Record<string, string>
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
      let newFolderPath = existingCharacter.folderPath;
      let newFilePath = existingCharacter.filePath;

      // Check if we need to move the folder (category or name changed)
      const categoryChanged = data.category && data.category !== existingCharacter.category;
      const nameChanged = data.name && data.name !== existingCharacter.name;

      if (categoryChanged || nameChanged) {
        const newName = data.name || existingCharacter.name;
        const newCategory = data.category || existingCharacter.category;
        const newSlug = slugify(newName);

        // Get category folder path based on folder mode
        const categoryFolderPath = this.getCategoryFolderPath(newCategory);

        let newCharacterFolderPath: string;
        if (categoryFolderPath === null) {
          // Flat mode: characters/<slug>/
          newCharacterFolderPath = pathJoin(project.path, 'characters', newSlug);
        } else {
          // Auto or Specify mode: characters/<category-folder>/<slug>/
          const newCategoryPath = pathJoin(project.path, 'characters', categoryFolderPath);
          newCharacterFolderPath = pathJoin(newCategoryPath, newSlug);

          // Create new category folder if it doesn't exist
          await this.electronService.createDirectory(newCategoryPath);
        }

        // Move the entire character folder
        const moveResult = await this.electronService.moveDirectory(
          existingCharacter.folderPath,
          newCharacterFolderPath
        );
        if (!moveResult.success) {
          throw new Error(`Failed to move character folder: ${moveResult.error}`);
        }

        // Update paths
        newFolderPath = newCharacterFolderPath;
        newFilePath = pathJoin(newCharacterFolderPath, `${newSlug}.md`);

        // If the slug changed, rename the main .md file
        if (nameChanged) {
          const oldSlug = slugify(existingCharacter.name);
          const oldMdPath = pathJoin(newCharacterFolderPath, `${oldSlug}.md`);
          const oldMdExists = await this.electronService.fileExists(oldMdPath);

          if (oldMdExists && oldSlug !== newSlug) {
            const copyResult = await this.electronService.copyFile(oldMdPath, newFilePath);
            if (copyResult.success) {
              await this.electronService.deleteFile(oldMdPath);
            }
          }
        }
      }

      // Handle thumbnail update
      let thumbnailFilename = existingCharacter.thumbnail;
      if (data.thumbnail && data.thumbnail !== existingCharacter.thumbnail) {
        // Remove old thumbnail if it exists
        if (existingCharacter.thumbnail) {
          const oldThumbnailPath = pathJoin(newFolderPath, existingCharacter.thumbnail);
          const thumbnailExists = await this.electronService.fileExists(oldThumbnailPath);
          if (thumbnailExists) {
            await this.electronService.deleteFile(oldThumbnailPath);
          }
        }
        // Upload new thumbnail to character folder
        thumbnailFilename = await this.handleThumbnailUploadToFolder(data.thumbnail, newFolderPath);
      }

      // Create updated character
      const updatedCharacter: Character = {
        ...existingCharacter,
        ...data,
        mangamaster: data.mangamaster !== undefined ? data.mangamaster : existingCharacter.mangamaster,
        thumbnail: thumbnailFilename,
        modified: new Date(),
        filePath: newFilePath,
        folderPath: newFolderPath,
      };

      // Save updated character to file
      await this.saveCharacterToFile(updatedCharacter);

      // Save additional fields if any changes were provided
      if (additionalFieldsChanges && Object.keys(additionalFieldsChanges).length > 0) {
        await this.saveAdditionalFields(id, additionalFieldsChanges);
      }

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
   * Deletes a character by moving it to the trash folder
   * Trash folder: characters/_deleted/<character-slug>-<timestamp>/
   */
  async deleteCharacter(id: string): Promise<boolean> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const characters = this.charactersSubject.value;
      const character = characters.find((char) => char.id === id);

      if (!character) {
        return false;
      }

      // Create trash folder if it doesn't exist
      const trashPath = pathJoin(project.path, 'characters', '_deleted');
      await this.electronService.createDirectory(trashPath);

      // Generate unique trash folder name with timestamp
      const characterSlug = slugify(character.name);
      const trashFolderName = slugifyWithTimestamp(characterSlug);
      const trashDestPath = pathJoin(trashPath, trashFolderName);

      // Move character folder to trash
      const moveResult = await this.electronService.moveDirectory(character.folderPath, trashDestPath);
      if (!moveResult.success) {
        throw new Error(`Failed to move character to trash: ${moveResult.error}`);
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
   * Restores a character from the trash
   * Moves it back to its original category folder
   */
  async restoreCharacter(trashFolderName: string): Promise<boolean> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const trashPath = pathJoin(project.path, 'characters', '_deleted');
      const characterTrashPath = pathJoin(trashPath, trashFolderName);

      // Check if trash folder exists
      const folderExists = await this.electronService.fileExists(characterTrashPath);
      if (!folderExists) {
        throw new Error('Character not found in trash');
      }

      // Load character metadata to get category
      const dirContents = await this.electronService.readDirectoryFiles(characterTrashPath);
      if (!dirContents.success || !dirContents.files || dirContents.files.length === 0) {
        throw new Error('No character file found in trash folder');
      }

      // Find the main .md file (should be the only one or named after the slug)
      const mdFiles = dirContents.files.filter((f) => f.endsWith('.md'));
      if (mdFiles.length === 0) {
        throw new Error('No markdown file found in trash folder');
      }

      const mainMdFile = mdFiles[0];
      const mainFilePath = pathJoin(characterTrashPath, mainMdFile);

      // Read character data to get category
      const readResult = await this.electronService.readFile(mainFilePath);
      if (!readResult.success) {
        throw new Error('Failed to read character file');
      }

      const parseResult = MarkdownUtils.parseMarkdown<CharacterFrontmatter>(readResult.content!);
      if (!parseResult.success) {
        throw new Error('Failed to parse character file');
      }

      const { frontmatter } = parseResult.data!;
      const characterCategory = frontmatter.category || 'uncategorized';
      const characterSlug = pathBasename(mainMdFile, '.md');

      // Get category folder path based on folder mode
      const categoryFolderPath = this.getCategoryFolderPath(characterCategory);

      // Determine restore destination based on folder mode
      let restorePath: string;
      if (categoryFolderPath === null) {
        // Flat mode: characters/<slug>/
        restorePath = pathJoin(project.path, 'characters', characterSlug);
      } else {
        // Auto or Specify mode: characters/<category-folder>/<slug>/
        const categoryPath = pathJoin(project.path, 'characters', categoryFolderPath);
        restorePath = pathJoin(categoryPath, characterSlug);

        // Create category folder if it doesn't exist
        await this.electronService.createDirectory(categoryPath);
      }

      // Move from trash back to category folder
      const moveResult = await this.electronService.moveDirectory(characterTrashPath, restorePath);
      if (!moveResult.success) {
        throw new Error(`Failed to restore character: ${moveResult.error}`);
      }

      // Reload characters to include the restored one
      await this.forceReloadCharacters();

      return true;
    } catch (error) {
      this.logger.error('Failed to restore character', error);
      throw new Error(`Failed to restore character: ${error}`);
    }
  }

  /**
   * Gets list of deleted characters from trash
   */
  async getDeletedCharacters(): Promise<Array<{ folderName: string; name: string; deletedAt: Date }>> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const trashPath = pathJoin(project.path, 'characters', '_deleted');

      // Check if trash folder exists
      const folderExists = await this.electronService.fileExists(trashPath);
      if (!folderExists) {
        return [];
      }

      const dirContents = await this.electronService.readDirectoryFiles(trashPath);
      if (!dirContents.success || !dirContents.directories) {
        return [];
      }

      const deletedCharacters: Array<{
        folderName: string;
        name: string;
        deletedAt: Date;
      }> = [];

      for (const folderName of dirContents.directories) {
        try {
          const characterFolderPath = pathJoin(trashPath, folderName);

          // Extract timestamp from folder name (format: slug-timestamp)
          const parts = folderName.split('-');
          const timestamp = parseInt(parts[parts.length - 1], 10);
          const deletedAt = !isNaN(timestamp) ? new Date(timestamp) : new Date();

          // Try to read character name from file
          const characterDirContents = await this.electronService.readDirectoryFiles(characterFolderPath);
          if (characterDirContents.success && characterDirContents.files) {
            const mdFiles = characterDirContents.files.filter((f) => f.endsWith('.md'));
            if (mdFiles.length > 0) {
              const mainMdFile = mdFiles[0];
              const mainFilePath = pathJoin(characterFolderPath, mainMdFile);
              const readResult = await this.electronService.readFile(mainFilePath);

              if (readResult.success) {
                const parseResult = MarkdownUtils.parseMarkdown<CharacterFrontmatter>(readResult.content!);
                if (parseResult.success) {
                  const { frontmatter } = parseResult.data!;
                  deletedCharacters.push({
                    folderName,
                    name: frontmatter.name,
                    deletedAt,
                  });
                  continue;
                }
              }
            }
          }

          // Fallback: use folder name if we couldn't read the character name
          const nameFromFolder = folderName.replace(/-\d+$/, '').replace(/-/g, ' ');
          deletedCharacters.push({
            folderName,
            name: nameFromFolder,
            deletedAt,
          });
        } catch (error) {
          console.warn(`Failed to process deleted character ${folderName}:`, error);
        }
      }

      // Sort by deletion date (newest first)
      deletedCharacters.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

      return deletedCharacters;
    } catch (error) {
      this.logger.error('Failed to get deleted characters', error);
      return [];
    }
  }

  /**
   * Permanently deletes all characters in trash
   */
  async emptyTrash(): Promise<boolean> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const trashPath = pathJoin(project.path, 'characters', '_deleted');

      // Check if trash folder exists
      const folderExists = await this.electronService.fileExists(trashPath);
      if (!folderExists) {
        return true; // Already empty
      }

      // Delete the entire trash folder recursively
      const deleteResult = await this.electronService.deleteDirectoryRecursive(trashPath);
      if (!deleteResult.success) {
        throw new Error(`Failed to empty trash: ${deleteResult.error}`);
      }

      // Recreate empty trash folder
      await this.electronService.createDirectory(trashPath);

      return true;
    } catch (error) {
      this.logger.error('Failed to empty trash', error);
      throw new Error(`Failed to empty trash: ${error}`);
    }
  }

  /**
   * Permanently deletes a single character from trash
   */
  async permanentlyDeleteCharacter(trashFolderName: string): Promise<boolean> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const trashPath = pathJoin(project.path, 'characters', '_deleted');
      const characterTrashPath = pathJoin(trashPath, trashFolderName);

      // Check if folder exists
      const folderExists = await this.electronService.fileExists(characterTrashPath);
      if (!folderExists) {
        return false;
      }

      // Delete the character folder permanently
      const deleteResult = await this.electronService.deleteDirectoryRecursive(characterTrashPath);
      if (!deleteResult.success) {
        throw new Error(`Failed to permanently delete character: ${deleteResult.error}`);
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to permanently delete character', error);
      throw new Error(`Failed to permanently delete character: ${error}`);
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

      // Check if folder still exists
      const folderExists = await this.electronService.fileExists(existingCharacter.folderPath);
      if (!folderExists) {
        // Folder was deleted externally, remove from memory
        const filteredCharacters = characters.filter((char) => char.id !== id);
        this.charactersSubject.next(filteredCharacters);
        return null;
      }

      // Extract category slug and character slug from folder path
      const categorySlug = pathBasename(
        pathDirname(existingCharacter.folderPath)
      );
      const characterSlug = pathBasename(existingCharacter.folderPath);

      // Reload character from folder
      const refreshedCharacter = await this.loadCharacterFromFolder(
        existingCharacter.folderPath,
        categorySlug,
        characterSlug
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
   * Loads a character from a folder
   * New structure: characters/<category>/<character-slug>/
   */
  private async loadCharacterFromFolder(
    folderPath: string,
    categorySlug: string,
    characterSlug: string
  ): Promise<Character | null> {
    try {
      // Main character file is <slug>.md
      const mainFilePath = pathJoin(folderPath, `${characterSlug}.md`);

      // Check if file exists first
      const fileExists = await this.electronService.fileExists(mainFilePath);
      if (!fileExists) {
        this.logger.log(`Character file not found: ${mainFilePath}, skipping`);
        return null;
      }

      const readResult = await this.electronService.readFile(mainFilePath);
      if (!readResult.success) {
        this.logger.error(`Failed to read character file ${mainFilePath}:`, readResult.error);
        return null;
      }

      const parseResult = MarkdownUtils.parseMarkdown<CharacterFrontmatter>(readResult.content!);
      if (!parseResult.success) {
        this.logger.error(`Failed to parse character file ${mainFilePath}:`, parseResult.error);
        return null;
      }

      const { frontmatter, content } = parseResult.data!;

      // Validate required fields
      if (!frontmatter.name) {
        this.logger.error(`Character file missing required name field: ${mainFilePath}`);
        return null;
      }

      // Extract description and notes from content
      const sections = this.parseCharacterContent(content);

      // Load additional markdown files in the folder
      const { fields: additionalFields, filenames: additionalFieldsFilenames } = await this.loadAdditionalFields(
        folderPath,
        characterSlug
      );

      // Use ID from frontmatter if available, otherwise generate from slug for backward compatibility
      const id = frontmatter.id || this.extractIdFromFilename(characterSlug);

      // Migration logic: Convert old thumbnail field to images array
      let images: CharacterImage[] = frontmatter.images || [];

      // If no images array but thumbnail exists, migrate it
      if (images.length === 0 && frontmatter.thumbnail) {
        images = [{
          id: generateId(),
          filename: frontmatter.thumbnail,
          tags: [],
          isPrimary: true,
          order: 0
        }];

        // Note: We'll migrate the actual file to images/ folder on next save
        // For now, keep backward compatibility by also setting thumbnail field
      }

      // Scan filesystem for image files and sync with metadata
      const originalImageCount = images.length;
      images = await this.syncImageFilesWithMetadata(folderPath, images);
      const imagesChanged = images.length !== originalImageCount;

      const character: Character = {
        id,
        name: frontmatter.name,
        category: frontmatter.category || categorySlug || 'uncategorized',
        tags: frontmatter.tags || [],
        books: frontmatter.books || [],
        thumbnail: frontmatter.thumbnail, // Keep for backward compatibility
        images: images,
        mangamaster: frontmatter.mangamaster || '',
        description: sections.description,
        notes: sections.notes,
        created: frontmatter.created ? new Date(frontmatter.created) : new Date(),
        modified: frontmatter.modified ? new Date(frontmatter.modified) : new Date(),
        filePath: mainFilePath,
        folderPath: folderPath,
        additionalFields: additionalFields,
        additionalFieldsFilenames: additionalFieldsFilenames,
      };

      // If images were added or removed, save the updated metadata
      if (imagesChanged) {
        const diff = images.length - originalImageCount;
        if (diff > 0) {
          this.logger.log(`Auto-detected ${diff} new image(s) for ${character.name}`);
        } else if (diff < 0) {
          this.logger.log(`Removed ${Math.abs(diff)} deleted image(s) from metadata for ${character.name}`);
        }
        // Save asynchronously without waiting (don't block loading)
        this.updateCharacterMetadata(character).catch((error) => {
          this.logger.error('Failed to save synced images', error);
        });
      }

      return character;
    } catch (error) {
      this.logger.error(`Failed to load character from ${folderPath}`, error);
      return null;
    }
  }

  /**
   * Loads additional markdown files from a character folder
   * Any .md file other than the main character file becomes an additional field
   * Returns both the field content and a mapping of field names to original filenames
   */
  private async loadAdditionalFields(
    folderPath: string,
    characterSlug: string
  ): Promise<{
    fields: Record<string, string>;
    filenames: Record<string, string>;
  }> {
    const fields: Record<string, string> = {};
    const filenames: Record<string, string> = {};

    try {
      const dirContents = await this.electronService.readDirectoryFiles(folderPath);
      if (!dirContents.success || !dirContents.files) {
        return { fields, filenames };
      }

      const mainFileName = `${characterSlug}.md`;

      for (const filename of dirContents.files) {
        // Skip the main character file
        if (filename === mainFileName) {
          continue;
        }

        // Only process .md files
        if (!filename.endsWith('.md')) {
          continue;
        }

        try {
          const filePath = pathJoin(folderPath, filename);
          const readResult = await this.electronService.readFile(filePath);

          if (readResult.success && readResult.content) {
            // Convert filename to field name (e.g., "another-file.md" -> "Another File")
            const fieldName = filenameToFieldName(filename);
            fields[fieldName] = readResult.content;
            filenames[fieldName] = filename; // Store original filename
          }
        } catch (error) {
          console.warn(`Failed to load additional field ${filename}:`, error);
          // Continue loading other fields even if one fails
        }
      }
    } catch (error) {
      console.warn(`Failed to load additional fields from ${folderPath}:`, error);
    }

    return { fields, filenames };
  }

  /**
   * Saves a character to a markdown file
   */
  private async saveCharacterToFile(character: Character): Promise<void> {
    try {
      const frontmatter: CharacterFrontmatter = {
        id: character.id,
        name: character.name,
        category: character.category,
        tags: character.tags,
        books: character.books,
        thumbnail: character.thumbnail, // Keep for backward compatibility
        images: character.images.length > 0 ? character.images : undefined, // Only save if not empty
        mangamaster: character.mangamaster,
        created: character.created.toISOString(),
        modified: character.modified.toISOString(),
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
      console.warn(
        `File deletion not available - this requires Electron main process handlers to be implemented: ${error}`
      );
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
      return (listResult.files || []).filter((file) => file.endsWith('.md'));
    } catch (error) {
      this.logger.error('Error getting character files', error);
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
    const charactersPath = pathJoin(projectPath, 'characters');
    const fullPath = pathJoin(charactersPath, baseFilename);

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
      const uniquePath = pathJoin(charactersPath, uniqueFilename);
      const uniqueExists = await this.electronService.fileExists(uniquePath);

      if (!uniqueExists) {
        break;
      }
      counter++;
    }

    return uniqueFilename;
  }

  /**
   * Handles thumbnail upload to character folder and returns the filename
   * New approach: stores thumbnail in character's own folder
   */
  private async handleThumbnailUploadToFolder(thumbnailPath: string, characterFolderPath: string): Promise<string> {
    try {
      // Get original filename and extension
      const originalFilename = pathBasename(thumbnailPath);
      const extension = originalFilename.split('.').pop() || 'jpg';
      const thumbnailFilename = `thumbnail.${extension}`;

      // Create destination path in character folder
      const destPath = pathJoin(characterFolderPath, thumbnailFilename);

      // Copy file to character folder
      const copyResult = await this.electronService.copyFile(thumbnailPath, destPath);
      if (!copyResult.success) {
        throw new Error(copyResult.error);
      }

      return thumbnailFilename;
    } catch (error) {
      console.warn(`Thumbnail copying failed: ${error}`);
      // Return original path as fallback
      return thumbnailPath;
    }
  }

  /**
   * Handles thumbnail upload and returns the filename
   * @deprecated Use handleThumbnailUploadToFolder for new folder structure
   * This method is kept for backward compatibility but should not be used for new characters.
   * It stores thumbnails in the global thumbnails/ directory which is no longer recommended.
   */
  private async handleThumbnailUpload(
    thumbnailPath: string,
    projectPath: string,
    characterId: string
  ): Promise<string> {
    try {
      // Generate unique filename for thumbnail
      const originalFilename = pathBasename(thumbnailPath);
      const extension = originalFilename.split('.').pop() || 'jpg';
      const thumbnailFilename = `${characterId}.${extension}`;

      // Create destination path
      const thumbnailsDir = pathJoin(projectPath, 'thumbnails');
      const destPath = pathJoin(thumbnailsDir, thumbnailFilename);

      // Copy file to thumbnails directory
      const copyResult = await this.electronService.copyFile(thumbnailPath, destPath);
      if (!copyResult.success) {
        throw new Error(copyResult.error);
      }

      return thumbnailFilename;
    } catch (error) {
      console.warn(
        `Thumbnail copying not available - this requires Electron main process handlers to be implemented: ${error}`
      );
      // Return original path as fallback
      return thumbnailPath;
    }
  }

  /**
   * Removes a thumbnail file from the global thumbnails directory
   * @deprecated This method is for the old global thumbnails structure.
   * New character thumbnails are stored in character folders and removed when the folder is deleted.
   */
  private async removeThumbnail(thumbnailFilename: string, projectPath: string): Promise<void> {
    try {
      const thumbnailPath = pathJoin(projectPath, 'thumbnails', thumbnailFilename);
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
  private parseCharacterContent(content: string): {
    description: string;
    notes: string;
  } {
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
      notes: notes.trim(),
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
    const availableBookIds = availableBooks.map((book) => book.id);

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


  /**
   * Adds a new image to a character
   */
  async addImage(characterId: string, imageFilePath: string, tags: string[] = []): Promise<void> {
    const characters = this.charactersSubject.value;
    const character = characters.find((char) => char.id === characterId);

    if (!character) {
      throw new Error('Character not found');
    }

    try {
      // Create images folder if it doesn't exist
      const imagesFolderPath = pathJoin(character.folderPath, 'images');
      const folderExists = await this.electronService.fileExists(imagesFolderPath);
      if (!folderExists) {
        const createResult = await this.electronService.createDirectory(imagesFolderPath);
        if (!createResult.success) {
          throw new Error(`Failed to create images directory: ${createResult.error}`);
        }
      }

      // Get the filename from the source path
      const originalFilename = pathBasename(imageFilePath);

      // Copy image to images folder
      const destPath = pathJoin(imagesFolderPath, originalFilename);
      const copyResult = await this.electronService.copyFile(imageFilePath, destPath);
      if (!copyResult.success) {
        throw new Error(`Failed to copy image: ${copyResult.error}`);
      }

      // Determine if this should be the primary image
      const isPrimary = character.images.length === 0;

      // Create CharacterImage object
      const newImage: CharacterImage = {
        id: generateId(),
        filename: originalFilename,
        tags: tags,
        isPrimary: isPrimary,
        order: character.images.length
      };

      // Add to character's images array
      character.images.push(newImage);
      character.modified = new Date();

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const updatedCharacters = characters.map((char) => (char.id === characterId ? character : char));
      this.charactersSubject.next(updatedCharacters);
    } catch (error) {
      this.logger.error('Failed to add image', error);
      throw new Error(`Failed to add image: ${error}`);
    }
  }

  /**
   * Removes an image from a character
   */
  async removeImage(characterId: string, imageId: string): Promise<void> {
    const characters = this.charactersSubject.value;
    const character = characters.find((char) => char.id === characterId);

    if (!character) {
      throw new Error('Character not found');
    }

    try {
      const imageToRemove = character.images.find((img) => img.id === imageId);
      if (!imageToRemove) {
        throw new Error('Image not found');
      }

      // Delete the image file
      const imagesFolderPath = pathJoin(character.folderPath, 'images');
      const imagePath = pathJoin(imagesFolderPath, imageToRemove.filename);
      const deleteResult = await this.electronService.deleteFile(imagePath);
      if (!deleteResult.success) {
        console.warn(`Failed to delete image file: ${deleteResult.error}`);
        // Continue anyway - frontmatter update is more important
      }

      // Remove from character's images array
      character.images = character.images.filter((img) => img.id !== imageId);

      // If removed image was primary and there are other images, make the first one primary
      if (imageToRemove.isPrimary && character.images.length > 0) {
        character.images[0].isPrimary = true;
      }

      // Reorder remaining images
      character.images.forEach((img, index) => {
        img.order = index;
      });

      character.modified = new Date();

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const updatedCharacters = characters.map((char) => (char.id === characterId ? character : char));
      this.charactersSubject.next(updatedCharacters);
    } catch (error) {
      this.logger.error('Failed to remove image', error);
      throw new Error(`Failed to remove image: ${error}`);
    }
  }

  /**
   * Updates image metadata (tags, order)
   */
  async updateImageMetadata(characterId: string, imageId: string, updates: Partial<CharacterImage>): Promise<void> {
    const characters = this.charactersSubject.value;
    const character = characters.find((char) => char.id === characterId);

    if (!character) {
      throw new Error('Character not found');
    }

    try {
      const imageIndex = character.images.findIndex((img) => img.id === imageId);
      if (imageIndex === -1) {
        throw new Error('Image not found');
      }

      // Update allowed fields
      if (updates.tags !== undefined) {
        character.images[imageIndex].tags = updates.tags;
      }
      if (updates.order !== undefined) {
        character.images[imageIndex].order = updates.order;
      }

      character.modified = new Date();

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const updatedCharacters = characters.map((char) => (char.id === characterId ? character : char));
      this.charactersSubject.next(updatedCharacters);
    } catch (error) {
      this.logger.error('Failed to update image metadata', error);
      throw new Error(`Failed to update image metadata: ${error}`);
    }
  }

  /**
   * Sets an image as the primary/thumbnail image
   */
  async setPrimaryImage(characterId: string, imageId: string): Promise<void> {
    const characters = this.charactersSubject.value;
    const character = characters.find((char) => char.id === characterId);

    if (!character) {
      throw new Error('Character not found');
    }

    try {
      // Unset all primary flags
      character.images.forEach((img) => {
        img.isPrimary = false;
      });

      // Set the specified image as primary
      const imageToSetPrimary = character.images.find((img) => img.id === imageId);
      if (!imageToSetPrimary) {
        throw new Error('Image not found');
      }

      imageToSetPrimary.isPrimary = true;
      character.modified = new Date();

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const updatedCharacters = characters.map((char) => (char.id === characterId ? character : char));
      this.charactersSubject.next(updatedCharacters);
    } catch (error) {
      this.logger.error('Failed to set primary image', error);
      throw new Error(`Failed to set primary image: ${error}`);
    }
  }

  /**
   * Reorders images for a character
   */
  async reorderImages(characterId: string, imageIds: string[]): Promise<void> {
    const characters = this.charactersSubject.value;
    const character = characters.find((char) => char.id === characterId);

    if (!character) {
      throw new Error('Character not found');
    }

    try {
      // Create a map of image IDs to images
      const imageMap = new Map<string, CharacterImage>();
      character.images.forEach((img) => imageMap.set(img.id, img));

      // Reorder images according to the provided array
      const reorderedImages: CharacterImage[] = [];
      imageIds.forEach((id, index) => {
        const image = imageMap.get(id);
        if (image) {
          image.order = index;
          reorderedImages.push(image);
        }
      });

      character.images = reorderedImages;
      character.modified = new Date();

      // Save character to file
      await this.saveCharacterToFile(character);

      // Update in-memory list
      const updatedCharacters = characters.map((char) => (char.id === characterId ? character : char));
      this.charactersSubject.next(updatedCharacters);
    } catch (error) {
      this.logger.error('Failed to reorder images', error);
      throw new Error(`Failed to reorder images: ${error}`);
    }
  }

  /**
   * Gets the path to an image file
   * Checks both new location (images/) and old location (root) for backward compatibility
   */
  async getImagePath(characterId: string, imageId: string): Promise<string | null> {
    const character = this.getCharacterById(characterId);
    if (!character) {
      return null;
    }

    const image = character.images?.find((img) => img.id === imageId);
    if (!image) {
      return null;
    }

    // Try new location first (images/ subfolder)
    const imagesFolderPath = pathJoin(character.folderPath, 'images');
    const newPath = pathJoin(imagesFolderPath, image.filename);

    const existsInNewLocation = await this.electronService.fileExists(newPath);
    if (existsInNewLocation) {
      return newPath;
    }

    // Fall back to old location (root folder) for migrated characters
    const oldPath = pathJoin(character.folderPath, image.filename);
    const existsInOldLocation = await this.electronService.fileExists(oldPath);
    if (existsInOldLocation) {
      return oldPath;
    }

    // File doesn't exist in either location
    return null;
  }

  /**
   * Gets the primary/thumbnail image for a character
   */
  getPrimaryImage(character: Character): CharacterImage | null {
    if (!character.images || character.images.length === 0) {
      return null;
    }
    const primaryImage = character.images.find((img) => img.isPrimary);
    return primaryImage || character.images[0];
  }

  /**
   * Handles file change events from the file watcher
   */
  private async handleFileChange(event: { type: string; path: string; filename: string }): Promise<void> {
    this.logger.log('File change detected:', event);

    // If we haven't loaded characters yet, don't try to handle changes
    if (!this.currentProjectPath) {
      return;
    }

    const isMarkdownFile = event.filename.endsWith('.md');
    const isImageFile = /\.(jpg|jpeg|png|gif|webp)$/i.test(event.filename);

    // Only process .md files and image files
    if (!isMarkdownFile && !isImageFile) {
      return;
    }

    try {
      // Check if the file is within a character folder
      const charactersPath = pathJoin(this.currentProjectPath, 'characters');

      // Make sure the changed file is under the characters directory
      if (!event.path.includes(charactersPath)) {
        return;
      }

      // For image files, handle them separately
      if (isImageFile) {
        await this.handleImageFileChange(event);
        return;
      }

      // Extract the character folder path from the file path
      const folderPath = pathDirname(event.path);

      // Find the character by folder path
      const characters = this.charactersSubject.value;
      const character = characters.find((char) => char.folderPath === folderPath);

      if (event.type === 'unlink') {
        // File was deleted
        if (character) {
          // Check if the character folder still exists
          const folderExists = await this.electronService.fileExists(folderPath);
          if (!folderExists) {
            // Entire folder was deleted, remove character
            const filteredCharacters = characters.filter((char) => char.folderPath !== folderPath);
            this.charactersSubject.next(filteredCharacters);
            this.logger.log(`Character removed due to folder deletion: ${character.name}`);
          } else {
            // Just a file was deleted, reload the character
            await this.refreshCharacter(character.id);
            this.logger.log(`Character reloaded after file deletion: ${character.name}`);
          }
        }
      } else if (event.type === 'change' || event.type === 'add') {
        // File was changed or added
        if (character) {
          // Existing character, reload it
          await this.refreshCharacter(character.id);
          this.logger.log(`Character reloaded: ${character.name}`);
        } else {
          // New character or file added to existing character
          // Force a full reload to detect new characters
          await this.forceReloadCharacters();
          this.logger.log('Characters reloaded due to new file');
        }
      }
    } catch (error) {
      this.logger.error('Error handling file change', error);
      // Don't throw - we don't want file watching errors to break the app
    }
  }

  /**
   * Handles image file changes (add/remove/change) in character folders
   */
  private async handleImageFileChange(event: { type: string; path: string; filename: string }): Promise<void> {
    if (!this.currentProjectPath) {
      return;
    }

    try {
      // Find which character folder this image belongs to
      const charactersPath = pathJoin(this.currentProjectPath, 'characters');

      // Navigate up the directory tree to find the character folder
      let currentPath = event.path;
      let characterFolderPath: string | null = null;
      let relativePath = '';

      // Keep going up until we find a folder that's a direct child of a category folder
      while (currentPath !== charactersPath) {
        const parentPath = pathDirname(currentPath);
        const parentParentPath = pathDirname(parentPath);

        // Check if parent's parent is the characters folder (meaning parent is category, current is character)
        if (parentParentPath === charactersPath) {
          characterFolderPath = currentPath;
          break;
        }

        // Store the relative path from character folder
        if (characterFolderPath === null) {
          const folderName = pathBasename(currentPath);
          relativePath = relativePath ? `${folderName}/${relativePath}` : folderName;
        }

        currentPath = parentPath;

        // Safety check to prevent infinite loop
        if (!currentPath || currentPath === '/') {
          return;
        }
      }

      if (!characterFolderPath) {
        return;
      }

      // Find the character by folder path
      const characters = this.charactersSubject.value;
      const character = characters.find((char) => char.folderPath === characterFolderPath);

      if (!character) {
        return;
      }

      if (event.type === 'add') {
        // New image file added
        await this.autoAddImageToCharacter(character, event.path, relativePath);
        this.logger.log(`Auto-added image to character ${character.name}: ${event.filename}`);
      } else if (event.type === 'unlink') {
        // Image file removed
        await this.autoRemoveImageFromCharacter(character, event.path);
        this.logger.log(`Auto-removed image from character ${character.name}: ${event.filename}`);
      }
      // We don't handle 'change' for images as it doesn't affect metadata
    } catch (error) {
      this.logger.error('Error handling image file change', error);
    }
  }

  /**
   * Automatically adds a newly detected image file to the character's images array
   */
  private async autoAddImageToCharacter(character: Character, imagePath: string, relativePath: string): Promise<void> {
    // Get just the filename
    const filename = pathBasename(imagePath);

    // Check if this image is already in the character's images array
    const existingImage = character.images?.find((img) => {
      // Compare by checking if the image path ends with the filename
      // This handles both old (root) and new (images/) locations
      return img.filename === filename || img.filename.endsWith(`/${filename}`);
    });

    if (existingImage) {
      // Image already exists, don't add again
      return;
    }

    // Extract auto-tags from subfolder structure
    const autoTags = this.extractAutoTagsFromPath(relativePath);

    // Determine the correct filename to store
    // If the image is in the root character folder, store just the filename
    // If it's in a subfolder, store the relative path from character folder
    let storedFilename = filename;
    if (relativePath && relativePath !== filename) {
      storedFilename = relativePath;
    }

    // Create new image entry
    const newImage: CharacterImage = {
      id: generateId(),
      filename: storedFilename,
      tags: autoTags,
      isPrimary: !character.images || character.images.length === 0, // First image becomes primary
      order: character.images ? character.images.length : 0
    };

    // Update character's images array
    const updatedImages = [...(character.images || []), newImage];
    character.images = updatedImages;

    // Save updated character
    await this.updateCharacterMetadata(character);

    // Refresh the character in the list
    await this.refreshCharacter(character.id);
  }

  /**
   * Automatically removes an image from character's images array when file is deleted
   */
  private async autoRemoveImageFromCharacter(character: Character, imagePath: string): Promise<void> {
    if (!character.images || character.images.length === 0) {
      return;
    }

    const filename = pathBasename(imagePath);

    // Find the image in the array
    const imageIndex = character.images.findIndex((img) => {
      return img.filename === filename || img.filename.endsWith(`/${filename}`);
    });

    if (imageIndex === -1) {
      // Image not found in array
      return;
    }

    const removedImage = character.images[imageIndex];
    const wasPrimary = removedImage.isPrimary;

    // Remove the image
    const updatedImages = character.images.filter((_, index) => index !== imageIndex);

    // If removed image was primary, make the first remaining image primary
    if (wasPrimary && updatedImages.length > 0) {
      updatedImages[0].isPrimary = true;
    }

    // Reorder remaining images
    updatedImages.forEach((img, index) => {
      img.order = index;
    });

    character.images = updatedImages;

    // Save updated character
    await this.updateCharacterMetadata(character);

    // Refresh the character in the list
    await this.refreshCharacter(character.id);
  }

  /**
   * Scans the character folder for image files and syncs them with the images array
   * Adds any new files found and removes files that no longer exist
   */
  private async syncImageFilesWithMetadata(
    characterFolderPath: string,
    existingImages: CharacterImage[]
  ): Promise<CharacterImage[]> {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    try {
      // Recursively scan for image files in the character folder
      const foundImages = await this.scanForImageFiles(characterFolderPath, characterFolderPath, imageExtensions);
      const foundPaths = new Set(foundImages.map(img => img.relativePath));

      // Start with empty array and rebuild
      const syncedImages: CharacterImage[] = [];
      let hasPrimary = false;

      // First pass: Keep existing images that still exist on disk
      for (const existingImage of existingImages) {
        // Check if this image file still exists on disk
        const exists = foundPaths.has(existingImage.filename) ||
                      Array.from(foundPaths).some(path => path.endsWith(`/${existingImage.filename}`));

        if (exists) {
          syncedImages.push(existingImage);
          if (existingImage.isPrimary) {
            hasPrimary = true;
          }
        } else {
          this.logger.log(`Removing deleted image from metadata: ${existingImage.filename}`);
        }
      }

      // Second pass: Add new images that aren't in metadata
      for (const { relativePath, autoTags } of foundImages) {
        // Check if this image already exists in the synced array
        const exists = syncedImages.some(
          (img) => img.filename === relativePath || img.filename.endsWith(`/${relativePath}`)
        );

        if (!exists) {
          // Add new image
          const newImage: CharacterImage = {
            id: generateId(),
            filename: relativePath,
            tags: autoTags,
            isPrimary: !hasPrimary && syncedImages.length === 0, // First image becomes primary if none set
            order: syncedImages.length,
          };
          syncedImages.push(newImage);
          if (!hasPrimary) {
            hasPrimary = true;
          }
        }
      }

      // If we had a primary but it was deleted, make the first image primary
      if (!hasPrimary && syncedImages.length > 0) {
        syncedImages[0].isPrimary = true;
      }

      // Reorder all images
      syncedImages.forEach((img, index) => {
        img.order = index;
      });

      return syncedImages;
    } catch (error) {
      this.logger.error('Error syncing image files', error);
      return existingImages; // Return existing images if scan fails
    }
  }

  /**
   * Recursively scans a directory for image files
   */
  private async scanForImageFiles(
    basePath: string,
    currentPath: string,
    extensions: string[]
  ): Promise<Array<{ relativePath: string; autoTags: string[] }>> {
    const results: Array<{ relativePath: string; autoTags: string[] }> = [];

    try {
      const dirContents = await this.electronService.readDirectoryFiles(currentPath);
      if (!dirContents.success) {
        return results;
      }

      // Process files in current directory
      if (dirContents.files) {
        for (const filename of dirContents.files) {
          const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
          if (extensions.includes(ext)) {
            const fullPath = pathJoin(currentPath, filename);
            const relativePath = await this.getRelativePath(basePath, fullPath);
            const autoTags = this.extractAutoTagsFromPath(relativePath);

            results.push({ relativePath, autoTags });
          }
        }
      }

      // Recursively process subdirectories
      if (dirContents.directories) {
        for (const dirname of dirContents.directories) {
          const subPath = pathJoin(currentPath, dirname);
          const subResults = await this.scanForImageFiles(basePath, subPath, extensions);
          results.push(...subResults);
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`Error scanning directory ${currentPath}`, error);
      return results;
    }
  }

  /**
   * Gets the relative path from base to target
   */
  private async getRelativePath(basePath: string, targetPath: string): Promise<string> {
    // Simple implementation: remove the base path prefix
    if (targetPath.startsWith(basePath)) {
      let relative = targetPath.substring(basePath.length);
      // Remove leading slash
      if (relative.startsWith('/') || relative.startsWith('\\')) {
        relative = relative.substring(1);
      }
      return relative;
    }
    return targetPath;
  }

  /**
   * Extracts auto-tags from the relative path within character folder
   * Example: "images/portraits/headshot.png" -> ["portraits"]
   *         "concept-art/early/sketch.png" -> ["concept-art", "early"]
   */
  private extractAutoTagsFromPath(relativePath: string): string[] {
    if (!relativePath) {
      return [];
    }

    // Split by path separator and remove the filename (last part)
    const parts = relativePath.split(/[\/\\]/);
    parts.pop(); // Remove filename

    // Filter out common folder names that shouldn't be tags
    const ignoredFolders = ['images', 'img', 'pictures', 'pics'];
    const tags = parts.filter((part) => !ignoredFolders.includes(part.toLowerCase()));

    return tags;
  }

  /**
   * Updates only the character's metadata (frontmatter) without reloading the entire character
   */
  private async updateCharacterMetadata(character: Character): Promise<void> {
    // Read current file content
    const currentContent = await this.electronService.readFile(character.filePath);
    if (!currentContent.success || !currentContent.content) {
      throw new Error('Failed to read character file');
    }

    // Parse to extract body content
    const parsed = MarkdownUtils.parseMarkdown(currentContent.content);
    if (!parsed.success || !parsed.data) {
      throw new Error('Failed to parse character markdown');
    }

    // Create updated frontmatter
    const frontmatter: any = {
      id: character.id,
      name: character.name,
      category: character.category,
      tags: character.tags,
      books: character.books,
      images: character.images,
      mangamaster: character.mangamaster,
      created: character.created,
      modified: new Date().toISOString()
    };

    // Regenerate markdown with updated frontmatter
    const updatedContent = MarkdownUtils.generateMarkdown(frontmatter, parsed.data.content);

    // Write back to file
    await this.electronService.writeFile(character.filePath, updatedContent);
  }
}
