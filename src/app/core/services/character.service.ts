import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { Character, CharacterFormData, CharacterFrontmatter, CharacterPrompt } from '../interfaces/character.interface';
import { Category } from '../interfaces/project.interface';
import { parseMarkdown, generateMarkdown } from '../utils/markdown.utils';
import { slugify } from '../utils/slug.utils';
import { pathJoin, pathBasename, pathDirname } from '../utils/path.utils';
import { parseThumbnailReference, resolveThumbnailPath, resolveThumbnailForStyle, normalizeThumbnailsMap, thumbnailCacheKey } from '../utils/thumbnail.utils';
import { normalizeBookCategories } from '../utils/character-category.utils';
import { assertIpcSuccess, withIpcError } from '../utils/ipc.utils';
import { requireProject } from '../utils/project.utils';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';
import { MetadataService } from './metadata.service';

/** Coerces a raw frontmatter `prompts` value into a clean CharacterPrompt[]. */
function normalizePrompts(raw: unknown): CharacterPrompt[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => ({
    name: typeof item?.name === 'string' ? item.name : '',
    positive: typeof item?.positive === 'string' ? item.positive : '',
    negative: typeof item?.negative === 'string' ? item.negative : '',
  }));
}

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
    private logger: LoggingService,
    private metadataService: MetadataService
  ) {
    // Subscribe to file changes to auto-reload characters
    this.fileWatcherService.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => {
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

  getCharacters(): Observable<Character[]> {
    return this.characters$;
  }

  /** Returns the currently cached characters for consumers that need an immediate snapshot. */
  getCharactersSnapshot(): Character[] {
    return this.charactersSubject.value;
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
    this.logger.warn('loadSpecificCharacterFile is deprecated - use forceReloadCharacters instead');
    await this.forceReloadCharacters();
    return null;
  }

  /**
   * Scans for existing character files more aggressively
   * @deprecated Legacy method - use forceReloadCharacters instead
   */
  async scanForExistingCharacters(): Promise<number> {
    this.logger.warn('scanForExistingCharacters is deprecated - use forceReloadCharacters instead');
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

      const parseResult = parseMarkdown<CharacterFrontmatter>(readResult.content!);
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

      const books = frontmatter.books || [];
      const { created, modified } = await this.resolveCharacterTimestamps(
        absolutePath,
        frontmatter.created,
        frontmatter.modified
      );
      const character: Character = {
        id: relativePath,
        name: frontmatter.name,
        category: frontmatter.category || 'uncategorized',
        tags: frontmatter.tags || [],
        books,
        bookCategories: normalizeBookCategories(frontmatter.bookCategories, books),
        thumbnails: normalizeThumbnailsMap(frontmatter.thumbnails),
        prompts: normalizePrompts(frontmatter.prompts),
        content: content || '',
        created,
        modified,
        filePath: absolutePath,
      };

      return character;
    } catch (error) {
      this.logger.error(`Failed to load character from ${absolutePath}`, error);
      return null;
    }
  }

  /**
   * Parse frontmatter ISO timestamps into Dates; when missing, backfill from file stats.
   * Character keeps Date; CharacterFrontmatter stores ISO strings on disk.
   */
  private async resolveCharacterTimestamps(
    absolutePath: string,
    createdRaw?: string,
    modifiedRaw?: string
  ): Promise<{ created: Date; modified: Date }> {
    let created = createdRaw ? new Date(createdRaw) : null;
    let modified = modifiedRaw ? new Date(modifiedRaw) : null;

    if (created && Number.isNaN(created.getTime())) {
      created = null;
    }
    if (modified && Number.isNaN(modified.getTime())) {
      modified = null;
    }

    if (!created || !modified) {
      const statsResult = await this.electronService.getFileStats(absolutePath);
      if (statsResult.success && statsResult.stats) {
        const ctime = new Date(statsResult.stats.ctime);
        const mtime = new Date(statsResult.stats.mtime);
        if (!created && !Number.isNaN(ctime.getTime())) {
          created = ctime;
        }
        if (!modified && !Number.isNaN(mtime.getTime())) {
          modified = mtime;
        }
      }
    }

    const fallback = new Date();
    return {
      created: created ?? fallback,
      modified: modified ?? created ?? fallback,
    };
  }

  /**
   * Creates a new character and saves it to disk as _<slug>.md
   *
   * Character storage location is intentionally decoupled from `category`.
   * This always writes directly under the project's `characters/` folder.
   */
  async createCharacter(data: CharacterFormData): Promise<Character> {
    try {
      const books = data.books || [];
      // Validate book references
      await this.validateBookReferences(books);
      const bookCategories = normalizeBookCategories(data.bookCategories, books);
      await this.validateBookCategoryReferences(bookCategories);

      const slug = slugify(data.name);
      const filename = `_${slug}.md`;

      let filePath: string;
      let relativePath: string;
      const charactersPath = this.projectService.getCharactersFolderPath();
      filePath = pathJoin(charactersPath, filename);
      relativePath = filename;

      const now = new Date();
      const character: Character = {
        id: relativePath,
        name: data.name,
        category: data.category,
        tags: data.tags || [],
        books,
        bookCategories,
        thumbnails: normalizeThumbnailsMap(data.thumbnails),
        prompts: normalizePrompts(data.prompts),
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
   * Updates an existing character and saves changes to disk.
   *
   * Moving/renaming the file is only done when the character `name` changes.
   * Changing `category` only updates frontmatter and keeps `character.id` stable.
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

      // Category changes only update frontmatter; file moves/renames happen only on name changes.
      const nameChanged = data.name && data.name !== existingCharacter.name;

      if (nameChanged) {
        const newName = data.name || existingCharacter.name;
        const newSlug = slugify(newName);
        const newFilename = `_${newSlug}.md`;

        // Preserve the existing directory (relative to `characters/`), so changing category
        // doesn't move files and doesn't change the plotboard thread mappings.
        const lastSlash = existingCharacter.id.lastIndexOf('/');
        const oldRelDir = lastSlash === -1 ? '' : existingCharacter.id.slice(0, lastSlash);
        newId = oldRelDir ? pathJoin(oldRelDir, newFilename) : newFilename;

        const oldAbsDir = pathDirname(existingCharacter.filePath);
        const destFilePath = pathJoin(oldAbsDir, newFilename);

        const moveResult = await this.electronService.moveDirectory(existingCharacter.filePath, destFilePath);
        if (!moveResult.success) {
          throw new Error(`Failed to move character file: ${moveResult.error}`);
        }

        newFilePath = destFilePath;
      }

      const nextBooks = data.books ?? existingCharacter.books;
      const nextBookCategories = normalizeBookCategories(
        'bookCategories' in data ? data.bookCategories : existingCharacter.bookCategories,
        nextBooks
      );
      await this.validateBookCategoryReferences(nextBookCategories);

      // Create updated character
      const updatedCharacter: Character = {
        ...existingCharacter,
        id: newId,
        name: data.name ?? existingCharacter.name,
        category: data.category ?? existingCharacter.category,
        tags: data.tags ?? existingCharacter.tags,
        books: nextBooks,
        bookCategories: nextBookCategories,
        thumbnails: 'thumbnails' in data
          ? normalizeThumbnailsMap(data.thumbnails)
          : existingCharacter.thumbnails,
        prompts: data.prompts !== undefined ? normalizePrompts(data.prompts) : existingCharacter.prompts,
        content: data.content !== undefined ? data.content : existingCharacter.content,
        modified: new Date(),
        filePath: newFilePath,
      };

      // Save updated character to file
      await this.saveCharacterToFile(updatedCharacter);

      // Thumbnail path changes must invalidate the persistent data URL cache.
      if (newId !== id || ('thumbnails' in data && !thumbnailsMapsEqual(data.thumbnails, existingCharacter.thumbnails))) {
        this.removeCachedThumbnailsForCharacter(id);
        if (newId !== id) {
          this.removeCachedThumbnailsForCharacter(newId);
        }
      }

      // Update in-memory list
      const updatedCharacters = [...characters];
      updatedCharacters[index] = updatedCharacter;
      const sortedCharacters = updatedCharacters.sort((a, b) => a.name.localeCompare(b.name));
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

      this.removeCachedThumbnailsForCharacter(id);

      // Update in-memory list
      const filteredCharacters = characters.filter((char) => char.id !== id);
      this.charactersSubject.next(filteredCharacters);

      try {
        await this.metadataService.removeCharacterFromBookPovs(id);
      } catch (cleanupError) {
        this.logger.error('Failed to remove deleted character from book PoV lists', cleanupError);
      }

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
        const updatedCharacters = [...characters];
        updatedCharacters[index] = refreshedCharacter;
        const sortedCharacters = updatedCharacters.sort((a, b) => a.name.localeCompare(b.name));
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
        ...(character.bookCategories && Object.keys(character.bookCategories).length > 0
          ? { bookCategories: character.bookCategories }
          : {}),
        ...(character.thumbnails && Object.keys(character.thumbnails).length > 0
          ? { thumbnails: character.thumbnails }
          : {}),
        ...(character.prompts && character.prompts.length > 0 ? { prompts: character.prompts } : {}),
        created: character.created.toISOString(),
        modified: character.modified.toISOString(),
      };

      const markdownContent = generateMarkdown(frontmatter, character.content);

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
    const project = requireProject(this.projectService.getCurrentProject());

    const availableBooks = project.metadata.books || [];
    const availableBookIds = availableBooks.map((book) => book.id);

    for (const bookId of books) {
      if (!availableBookIds.includes(bookId)) {
        throw new Error(`Referenced book '${bookId}' does not exist in project metadata`);
      }
    }
  }

  /**
   * Validates that bookCategories keys are known books and values are known categories.
   */
  private async validateBookCategoryReferences(
    bookCategories?: Record<string, string>
  ): Promise<void> {
    if (!bookCategories || Object.keys(bookCategories).length === 0) {
      return;
    }

    const project = requireProject(this.projectService.getCurrentProject());

    const availableBookIds = new Set((project.metadata.books || []).map((book) => book.id));
    const availableCategoryIds = new Set(
      (project.metadata.categories || []).map((category) => category.id)
    );

    for (const [bookId, categoryId] of Object.entries(bookCategories)) {
      if (!availableBookIds.has(bookId)) {
        throw new Error(`Referenced book '${bookId}' does not exist in project metadata`);
      }
      if (!availableCategoryIds.has(categoryId)) {
        throw new Error(
          `Book category override '${categoryId}' for book '${bookId}' does not exist in project metadata`
        );
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

  getCachedThumbnail(characterId: string, styleId?: string): string | null {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    return this.thumbnailDataUrls.get(thumbnailCacheKey(characterId, style)) || null;
  }

  /**
   * Loads a character's thumbnail for a style from disk and caches it.
   * Resolves Obsidian wiki-link format [[img/path.png]] or plain paths.
   * Returns null when the style has no thumbnail set (caller should show placeholder).
   */
  async loadThumbnailForCharacter(character: Character, styleId?: string): Promise<string | null> {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    const raw = resolveThumbnailForStyle(character.thumbnails, style);
    if (!raw) {
      return null;
    }
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return null;
    }
    const parsed = parseThumbnailReference(raw);
    if (!parsed) {
      return null;
    }
    const absolutePath = resolveThumbnailPath(project.path, parsed);
    try {
      const dataUrl = await this.electronService.getImageAsDataUrl(absolutePath);
      if (dataUrl) {
        const modTime = character.modified?.toISOString() ?? '';
        this.setCachedThumbnail(character.id, style, dataUrl, modTime);
        return dataUrl;
      }
    } catch (error) {
      this.logger.error(`Failed to load thumbnail for character ${character.name}:`, error);
    }
    return null;
  }

  /**
   * Batch loads thumbnails for characters for the given style (default style if omitted).
   */
  async loadThumbnailsForCharacters(characters: Character[], styleId?: string): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return;
    }
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    const toLoad = characters.filter((c) => {
      const raw = resolveThumbnailForStyle(c.thumbnails, style);
      return !!raw && !this.thumbnailDataUrls.has(thumbnailCacheKey(c.id, style));
    });
    await Promise.all(toLoad.map((char) => this.loadThumbnailForCharacter(char, style)));
  }

  setCachedThumbnail(
    characterId: string,
    styleId: string,
    dataUrl: string,
    modificationTime: string
  ): void {
    const key = thumbnailCacheKey(characterId, styleId);
    this.thumbnailDataUrls.set(key, dataUrl);
    this.thumbnailModificationTimes.set(key, modificationTime);
  }

  getCachedThumbnailModTime(characterId: string, styleId?: string): string | null {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    return this.thumbnailModificationTimes.get(thumbnailCacheKey(characterId, style)) || null;
  }

  removeCachedThumbnail(characterId: string, styleId?: string): void {
    if (styleId) {
      const key = thumbnailCacheKey(characterId, styleId);
      this.thumbnailDataUrls.delete(key);
      this.thumbnailModificationTimes.delete(key);
      return;
    }
    this.removeCachedThumbnailsForCharacter(characterId);
  }

  /** Removes all cached style variants for a character. */
  removeCachedThumbnailsForCharacter(characterId: string): void {
    const prefix = `${characterId}:`;
    for (const key of [...this.thumbnailDataUrls.keys()]) {
      if (key.startsWith(prefix) || key === characterId) {
        this.thumbnailDataUrls.delete(key);
        this.thumbnailModificationTimes.delete(key);
      }
    }
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
   * Gets cached thumbnail data URLs for a style as Map<characterId, dataUrl>
   * (for passing to child components that key by character id only).
   */
  getAllCachedThumbnails(styleId?: string): Map<string, string> {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    const result = new Map<string, string>();
    const suffix = `:${style}`;
    for (const [key, value] of this.thumbnailDataUrls) {
      if (key.endsWith(suffix)) {
        const characterId = key.slice(0, -suffix.length);
        result.set(characterId, value);
      }
    }
    return result;
  }

}

function thumbnailsMapsEqual(
  a: Record<string, string> | undefined | null,
  b: Record<string, string> | undefined | null
): boolean {
  const normA = normalizeThumbnailsMap(a) || {};
  const normB = normalizeThumbnailsMap(b) || {};
  const keysA = Object.keys(normA);
  const keysB = Object.keys(normB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => normA[k] === normB[k]);
}
