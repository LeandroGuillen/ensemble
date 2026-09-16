import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { Character, CharacterFormData, CharacterFrontmatter, CharacterPrompt } from '../interfaces/character.interface';
import { Category } from '../interfaces/project.interface';
import { parseMarkdown, generateMarkdown } from '../utils/markdown.utils';
import { asciiSlugify } from '../utils/slug.utils';
import { generateId } from '../utils/id.utils';
import {
  buildCharacterIdRemap,
  normalizeCharacterRelativePath,
} from '../utils/character-id.utils';
import { pathJoin, pathBasename, pathDirname } from '../utils/path.utils';
import {
  CHARACTER_DRAFTS_FOLDER,
  isFolderBasedCharacterPath,
  isLegacyCharacterMainFile,
  parseCharacterMainFileLocation,
} from '../utils/character-path.utils';
import { parseThumbnailReference, resolveThumbnailPath, resolveThumbnailForStyle, resolveThumbnailForBookStyle, normalizeThumbnailsMap, normalizeBookThumbnailsMap, thumbnailCacheKey } from '../utils/thumbnail.utils';
import { normalizeBookCategories } from '../utils/character-category.utils';
import { normalizeAliases } from '../utils/character-alias.utils';
import { normalizeBookCode } from '../utils/book-display.utils';
import { assertIpcSuccess, withIpcError } from '../utils/ipc.utils';
import { requireProject } from '../utils/project.utils';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';
import { MetadataService } from './metadata.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';

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
  private draftsSubject = new BehaviorSubject<Character[]>([]);
  public drafts$ = this.draftsSubject.asObservable();
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
    private metadataService: MetadataService,
    private plotBoardService: PlotBoardService,
    private castService: CastService
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
      return asciiSlugify(categoryId);
    }

    const category = project.metadata.categories.find((c) => c.id === categoryId);
    if (!category) {
      // Category not found, use slugified ID
      return asciiSlugify(categoryId);
    }

    const folderMode = category.folderMode || 'auto'; // Default to 'auto' for backward compatibility

    switch (folderMode) {
      case 'flat':
        return null; // No subfolder, characters go directly in characters/
      case 'specify':
        return category.folderPath || asciiSlugify(categoryId); // Use custom path or fallback to slug
      case 'auto':
      default:
        return asciiSlugify(categoryId); // Use category slug as folder name
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

  /** Drafts are deliberately isolated from all normal character consumers. */
  getDrafts(): Observable<Character[]> {
    return this.drafts$;
  }

  getDraftsSnapshot(): Character[] {
    return this.draftsSubject.value;
  }

  /** Returns the currently cached characters for consumers that need an immediate snapshot. */
  getCharactersSnapshot(): Character[] {
    return this.charactersSubject.value;
  }

  getCharacterById(id: string): Character | undefined {
    return this.findCharacter(id);
  }

  getDraftById(id: string): Character | undefined {
    return this.findInCollection(this.draftsSubject.value, id);
  }

  /** Matches stable id, or a leftover path-based id via `relativePath`. */
  private findCharacter(id: string): Character | undefined {
    return this.findInCollection(this.charactersSubject.value, id);
  }

  /** Internal lookup for operations shared by active characters and drafts. */
  private findRecord(id: string): Character | undefined {
    return this.findCharacter(id) || this.getDraftById(id);
  }

  private findInCollection(characters: Character[], id: string): Character | undefined {
    const normalized = normalizeCharacterRelativePath(id);
    return characters.find(
      (char) =>
        char.id === id ||
        char.id === normalized ||
        char.relativePath === normalized ||
        char.relativePath === id
    );
  }

  /** Returns the absolute file path for `<character-slug>.<book-code>.md`. */
  getBookPageFilePath(character: Character, bookId: string): string {
    const normalizedPath = character.filePath.replace(/\\/g, '/');
    const dir = pathDirname(normalizedPath);
    const base = pathBasename(normalizedPath, '.md');
    if (!isFolderBasedCharacterPath(character.relativePath)) {
      return pathJoin(dir, `${base}-${bookId}.md`);
    }
    const book = this.projectService
      .getCurrentProject()
      ?.metadata.books?.find((candidate) => candidate.id === bookId);
    const code =
      asciiSlugify(normalizeBookCode(book?.code) || bookId) || asciiSlugify(bookId);
    return pathJoin(dir, `${base}.${code}.md`);
  }

  /**
   * Checks if a book page file exists for the given character and book.
   */
  async bookPageExists(characterId: string, bookId: string): Promise<boolean> {
    const character = this.findRecord(characterId);
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
    const character = this.findRecord(characterId);
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
    const character = this.findRecord(characterId);
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
      this.draftsSubject.next([]);
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
   * Loads one conventionally named main file per character folder. Drafts live
   * below `@drafts`; unrelated markdown and book pages are ignored.
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
      this.draftsSubject.next([]);
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

      const scanResult = await this.electronService.readDirectoryRecursive(charactersPath, '*.md');
      if (!scanResult.success || !scanResult.files) {
        this.hasLoadedForCurrentProject = true;
        return;
      }

      const records: Character[] = [];
      const needsIdPersist: Character[] = [];

      for (const { relativePath, absolutePath } of scanResult.files) {
        try {
          const location = parseCharacterMainFileLocation(relativePath);
          const isLegacy = isLegacyCharacterMainFile(relativePath);
          if (!location && !isLegacy) continue;

          const loaded = await this.loadCharacterFromFile(
            absolutePath,
            relativePath,
            location?.draft
          );
          if (loaded) {
            records.push(loaded.character);
            if (loaded.assignedId) {
              needsIdPersist.push(loaded.character);
            }
          }
        } catch (error) {
          this.logger.error(`Failed to load character from ${relativePath}:`, error);
        }
      }

      this.assignUniqueCharacterIds(records, needsIdPersist);

      const characters = records
        .filter((record) => !record.draft)
        .sort((a, b) => a.name.localeCompare(b.name));
      const drafts = records
        .filter((record) => record.draft)
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());
      await this.persistAssignedIdsAndRemap(records, needsIdPersist);
      this.charactersSubject.next(characters);
      this.draftsSubject.next(drafts);
      this.hasLoadedForCurrentProject = true;
    } catch (error) {
      this.logger.error('Failed to load characters', error);
      throw new Error(`Failed to load characters: ${error}`);
    }
  }

  /**
   * Loads a character from its main markdown file.
   */
  private async loadCharacterFromFile(
    absolutePath: string,
    relativePath: string,
    draftFromPath?: boolean
  ): Promise<{ character: Character; assignedId: boolean } | null> {
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

      // Folder-based records derive lifecycle state from their location. The
      // frontmatter flag remains readable only for the legacy flat-file format.
      const isDraft = draftFromPath ?? frontmatter.draft === true;
      // Active character files retain their existing integrity requirement.
      if (!isDraft && !frontmatter.name) {
        this.logger.error(`Character file missing required name field: ${absolutePath}`);
        return null;
      }

      const books = frontmatter.books || [];
      const { created, modified } = await this.resolveCharacterTimestamps(
        absolutePath,
        frontmatter.created,
        frontmatter.modified
      );
      const normalizedRelativePath = normalizeCharacterRelativePath(relativePath);
      const storedId = typeof frontmatter.id === 'string' ? frontmatter.id.trim() : '';
      const assignedId = !storedId;
      const character: Character = {
        id: storedId || generateId(),
        draft: isDraft || undefined,
        name: typeof frontmatter.name === 'string' ? frontmatter.name : '',
        aliases: normalizeAliases(frontmatter.aliases),
        category: frontmatter.category || 'uncategorized',
        tags: frontmatter.tags || [],
        books,
        bookCategories: normalizeBookCategories(frontmatter.bookCategories, books),
        thumbnails: normalizeThumbnailsMap(frontmatter.thumbnails),
        bookThumbnails: normalizeBookThumbnailsMap(frontmatter.bookThumbnails, books),
        prompts: normalizePrompts(frontmatter.prompts),
        content: content || '',
        created,
        modified,
        relativePath: normalizedRelativePath,
        filePath: absolutePath,
      };

      return { character, assignedId };
    } catch (error) {
      this.logger.error(`Failed to load character from ${absolutePath}`, error);
      return null;
    }
  }

  private assignUniqueCharacterIds(characters: Character[], needsIdPersist: Character[]): void {
    const seen = new Set<string>();
    for (const character of characters) {
      if (!character.id || seen.has(character.id)) {
        character.id = generateId();
        if (!needsIdPersist.includes(character)) {
          needsIdPersist.push(character);
        }
      }
      seen.add(character.id);
    }
  }

  private async persistAssignedIdsAndRemap(
    characters: Character[],
    needsIdPersist: Character[]
  ): Promise<void> {
    for (const character of needsIdPersist) {
      try {
        await this.saveCharacterToFile(character);
      } catch (error) {
        this.logger.error(`Failed to persist stable id for ${character.relativePath}`, error);
      }
    }

    const idMap = buildCharacterIdRemap(characters);
    if (idMap.size === 0) {
      return;
    }

    let remappedProject = false;
    try {
      remappedProject = await this.projectService.remapCharacterIds(idMap);
    } catch (error) {
      this.logger.error('Failed to remap character ids in project metadata', error);
    }

    try {
      await this.plotBoardService.remapCharacterIdsAcrossProject(idMap);
    } catch (error) {
      this.logger.error('Failed to remap character ids in plot boards', error);
    }

    // Cast references live in casts.json (CastService handles the rewrite)
    try {
      await this.castService.remapCharacterIds(idMap);
    } catch (error) {
      this.logger.error('Failed to remap character ids in casts.json', error);
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

  private async findAvailableFolderName(
    parentPath: string,
    name: string,
    id: string,
    currentFolderPath?: string
  ): Promise<string> {
    const base = asciiSlugify(name) || 'unnamed';
    const normalizedCurrent = currentFolderPath?.replace(/\\/g, '/');
    const isAvailable = async (folderName: string): Promise<boolean> => {
      const candidate = pathJoin(parentPath, folderName);
      return candidate === normalizedCurrent || !(await this.electronService.fileExists(candidate));
    };

    if (await isAvailable(base)) return base;

    const idPart = asciiSlugify(id).slice(-8) || 'character';
    const withId = `${base}-${idPart}`;
    if (await isAvailable(withId)) return withId;

    let suffix = 2;
    while (!(await isAvailable(`${withId}-${suffix}`))) suffix += 1;
    return `${withId}-${suffix}`;
  }

  private characterPaths(
    charactersPath: string,
    folderName: string,
    draft: boolean
  ): { folderPath: string; filePath: string; relativePath: string } {
    const relativeFolder = draft
      ? pathJoin(CHARACTER_DRAFTS_FOLDER, folderName)
      : folderName;
    const relativePath = pathJoin(relativeFolder, `${folderName}.md`);
    const folderPath = pathJoin(charactersPath, relativeFolder);
    return {
      folderPath,
      filePath: pathJoin(charactersPath, relativePath),
      relativePath,
    };
  }

  /**
   * Creates `<characters>/<slug>/<slug>.md`.
   */
  async createCharacter(data: CharacterFormData): Promise<Character> {
    let createdFolderPath: string | null = null;
    try {
      const books = data.books || [];
      // Validate book references
      await this.validateBookReferences(books);
      const bookCategories = normalizeBookCategories(data.bookCategories, books);
      await this.validateBookCategoryReferences(bookCategories);

      const id = generateId();
      const charactersPath = this.projectService.getCharactersFolderPath();
      const folderName = await this.findAvailableFolderName(charactersPath, data.name, id);
      const { folderPath, filePath, relativePath } = this.characterPaths(
        charactersPath,
        folderName,
        false
      );
      assertIpcSuccess(
        await this.electronService.createDirectory(folderPath),
        'Create character directory'
      );
      createdFolderPath = folderPath;

      const now = new Date();
      const character: Character = {
        id,
        name: data.name,
        aliases: normalizeAliases(data.aliases),
        category: data.category,
        tags: data.tags || [],
        books,
        bookCategories,
        thumbnails: normalizeThumbnailsMap(data.thumbnails),
        bookThumbnails: normalizeBookThumbnailsMap(data.bookThumbnails, books),
        prompts: normalizePrompts(data.prompts),
        content: data.content || '',
        created: now,
        modified: now,
        relativePath,
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
      if (createdFolderPath) {
        await this.electronService.deleteDirectoryRecursive(createdFolderPath);
      }
      this.logger.error('Failed to create character', error);
      throw new Error(`Failed to create character: ${error}`);
    }
  }

  /** Creates a draft. User-authored fields may all be empty. */
  async createDraft(data: CharacterFormData): Promise<Character> {
    let createdFolderPath: string | null = null;
    try {
      const books = data.books || [];
      await this.validateBookReferences(books);
      const bookCategories = normalizeBookCategories(data.bookCategories, books);
      await this.validateBookCategoryReferences(bookCategories);

      const id = generateId();
      const charactersPath = this.projectService.getCharactersFolderPath();
      const draftsPath = pathJoin(charactersPath, CHARACTER_DRAFTS_FOLDER);
      const folderName = await this.findAvailableFolderName(draftsPath, data.name, id);
      const { folderPath, filePath, relativePath } = this.characterPaths(
        charactersPath,
        folderName,
        true
      );
      assertIpcSuccess(
        await this.electronService.createDirectory(folderPath),
        'Create character draft directory'
      );
      createdFolderPath = folderPath;
      const now = new Date();
      const draft: Character = {
        id,
        draft: true,
        name: data.name || '',
        aliases: normalizeAliases(data.aliases),
        category: data.category || '',
        tags: data.tags || [],
        books,
        bookCategories,
        thumbnails: normalizeThumbnailsMap(data.thumbnails),
        bookThumbnails: normalizeBookThumbnailsMap(data.bookThumbnails, books),
        prompts: normalizePrompts(data.prompts),
        content: data.content || '',
        created: now,
        modified: now,
        relativePath,
        filePath,
      };

      await this.saveCharacterToFile(draft);
      this.draftsSubject.next([draft, ...this.draftsSubject.value]);
      return draft;
    } catch (error) {
      if (createdFolderPath) {
        await this.electronService.deleteDirectoryRecursive(createdFolderPath);
      }
      this.logger.error('Failed to create character draft', error);
      throw new Error(`Failed to create character draft: ${error}`);
    }
  }

  private rewriteMovedThumbnailReferences(
    character: Character,
    oldFolderPath: string,
    newFolderPath: string
  ): Pick<Character, 'thumbnails' | 'bookThumbnails'> {
    const projectPath = this.projectService.getCurrentProject()?.path?.replace(/\\/g, '/');
    if (!projectPath) {
      return { thumbnails: character.thumbnails, bookThumbnails: character.bookThumbnails };
    }

    const toRelative = (absolutePath: string): string =>
      absolutePath.replace(/\\/g, '/').replace(`${projectPath.replace(/\/+$/, '')}/`, '');
    const oldPrefix = `${toRelative(oldFolderPath).replace(/\/+$/, '')}/`;
    const newPrefix = `${toRelative(newFolderPath).replace(/\/+$/, '')}/`;
    const rewrite = (raw: string): string => {
      const parsed = parseThumbnailReference(raw);
      if (!parsed || !parsed.replace(/\\/g, '/').startsWith(oldPrefix)) return raw;
      return raw.replace(parsed, `${newPrefix}${parsed.replace(/\\/g, '/').slice(oldPrefix.length)}`);
    };
    const rewriteMap = (map?: Record<string, string>): Record<string, string> | undefined =>
      map
        ? Object.fromEntries(Object.entries(map).map(([style, raw]) => [style, rewrite(raw)]))
        : undefined;

    return {
      thumbnails: rewriteMap(character.thumbnails),
      bookThumbnails: character.bookThumbnails
        ? Object.fromEntries(
            Object.entries(character.bookThumbnails).map(([bookId, map]) => [
              bookId,
              rewriteMap(map) || {},
            ])
          )
        : undefined,
    };
  }

  /** Moves a folder-based record and keeps its main/book filenames aligned with the folder. */
  private async relocateFolderCharacter(
    character: Character,
    name: string,
    draft: boolean
  ): Promise<Character> {
    const charactersPath = this.projectService.getCharactersFolderPath();
    const oldFolderPath = pathDirname(character.filePath);
    const targetParent = draft
      ? pathJoin(charactersPath, CHARACTER_DRAFTS_FOLDER)
      : charactersPath;
    const folderName = await this.findAvailableFolderName(
      targetParent,
      name,
      character.id,
      oldFolderPath
    );
    const destination = this.characterPaths(charactersPath, folderName, draft);
    const oldMainName = pathBasename(character.filePath);
    const stagedMainPath = pathJoin(destination.folderPath, oldMainName);

    if (oldFolderPath !== destination.folderPath) {
      const folderMove = await this.electronService.moveDirectory(
        oldFolderPath,
        destination.folderPath
      );
      if (!folderMove.success) {
        throw new Error(`Failed to move character directory: ${folderMove.error}`);
      }
    }

    const movedSidecars: Array<{ from: string; to: string }> = [];
    try {
      if (oldMainName !== pathBasename(destination.filePath)) {
        const stagedRecord = { ...character, filePath: stagedMainPath };
        const destinationRecord = { ...character, filePath: destination.filePath };
        for (const bookId of character.books || []) {
          const from = this.getBookPageFilePath(stagedRecord, bookId);
          if (!(await this.electronService.fileExists(from))) continue;
          const to = this.getBookPageFilePath(destinationRecord, bookId);
          const sidecarMove = await this.electronService.moveDirectory(from, to);
          if (!sidecarMove.success) {
            throw new Error(`Failed to rename book page: ${sidecarMove.error}`);
          }
          movedSidecars.push({ from, to });
        }

        const mainMove = await this.electronService.moveDirectory(
          stagedMainPath,
          destination.filePath
        );
        if (!mainMove.success) {
          throw new Error(`Failed to rename character file: ${mainMove.error}`);
        }
      }
    } catch (error) {
      for (const moved of movedSidecars.reverse()) {
        await this.electronService.moveDirectory(moved.to, moved.from);
      }
      if (oldFolderPath !== destination.folderPath) {
        await this.electronService.moveDirectory(destination.folderPath, oldFolderPath);
      }
      throw error;
    }

    return {
      ...character,
      ...this.rewriteMovedThumbnailReferences(
        character,
        oldFolderPath,
        destination.folderPath
      ),
      draft: draft || undefined,
      name,
      relativePath: destination.relativePath,
      filePath: destination.filePath,
    };
  }

  /** Promotes an explicitly saved draft into the active character collection. */
  async promoteDraft(id: string): Promise<Character> {
    const draft = this.getDraftById(id);
    if (!draft) {
      throw new Error('Character draft not found');
    }
    if (!draft.name.trim()) {
      throw new Error('A name is required before promoting this draft');
    }
    if (!draft.category.trim()) {
      throw new Error('A category is required before promoting this draft');
    }

    const relocated = isFolderBasedCharacterPath(draft.relativePath)
      ? await this.relocateFolderCharacter(draft, draft.name, false)
      : draft;
    const promoted: Character = { ...relocated, draft: undefined, modified: new Date() };
    try {
      await this.saveCharacterToFile(promoted);
    } catch (error) {
      if (relocated.filePath !== draft.filePath) {
        await this.relocateFolderCharacter(relocated, draft.name, true);
      }
      throw error;
    }

    this.draftsSubject.next(this.draftsSubject.value.filter((item) => item.id !== id));
    this.charactersSubject.next(
      [...this.charactersSubject.value, promoted].sort((a, b) => a.name.localeCompare(b.name))
    );
    return promoted;
  }

  /** Demotes an active folder-based character back into the drafts collection. */
  async moveToDraft(id: string): Promise<Character> {
    const character = this.getCharacterById(id);
    if (!character) {
      throw new Error('Character not found');
    }
    if (!isFolderBasedCharacterPath(character.relativePath)) {
      throw new Error('Only characters stored in folders can be moved to drafts');
    }

    const relocated = await this.relocateFolderCharacter(character, character.name, true);
    const draft: Character = { ...relocated, draft: true, modified: new Date() };
    try {
      await this.saveCharacterToFile(draft);
    } catch (error) {
      if (relocated.filePath !== character.filePath) {
        await this.relocateFolderCharacter(relocated, character.name, false);
      }
      throw error;
    }

    this.charactersSubject.next(this.charactersSubject.value.filter((item) => item.id !== id));
    this.draftsSubject.next([...this.draftsSubject.value, draft]);
    return draft;
  }

  /**
   * Updates an existing character and saves changes to disk.
   *
   * Moving/renaming the file is only done when the character `name` changes.
   * Changing `category` or `name` keeps `character.id` stable; only `relativePath` changes on rename.
   */
  async updateCharacter(
    id: string,
    data: Partial<CharacterFormData>
  ): Promise<Character | null> {
    requireProject(this.projectService.getCurrentProject());

    try {
      // Validate book references if books are being updated
      if (data.books) {
        await this.validateBookReferences(data.books);
      }

      const isDraft = !!this.getDraftById(id);
      const sourceSubject = isDraft ? this.draftsSubject : this.charactersSubject;
      const characters = sourceSubject.value;
      const existingCharacter = this.findRecord(id);
      const index = existingCharacter
        ? characters.findIndex((char) => char.id === existingCharacter.id)
        : -1;

      if (!existingCharacter || index === -1) {
        return null;
      }

      let newFilePath = existingCharacter.filePath;
      let newRelativePath = existingCharacter.relativePath;
      let relocatedCharacter = existingCharacter;

      // Category changes only update frontmatter; file moves/renames happen only on name changes.
      const nameChanged = data.name && data.name !== existingCharacter.name;

      if (nameChanged) {
        const newName = data.name || existingCharacter.name;
        if (isFolderBasedCharacterPath(existingCharacter.relativePath)) {
          relocatedCharacter = await this.relocateFolderCharacter(
            existingCharacter,
            newName,
            isDraft
          );
          newFilePath = relocatedCharacter.filePath;
          newRelativePath = relocatedCharacter.relativePath;
        } else {
          // Transitional behavior for the former `_name.md` layout.
          const newFilename = `_${asciiSlugify(newName) || 'unnamed'}.md`;
          const oldRelDir = pathDirname(existingCharacter.relativePath);
          newRelativePath = oldRelDir === '.'
            ? newFilename
            : pathJoin(oldRelDir, newFilename);
          const destFilePath = pathJoin(pathDirname(existingCharacter.filePath), newFilename);
          const moveResult = await this.electronService.moveDirectory(
            existingCharacter.filePath,
            destFilePath
          );
          if (!moveResult.success) {
            throw new Error(`Failed to move character file: ${moveResult.error}`);
          }
          newFilePath = destFilePath;
        }
      }

      const nextBooks = data.books ?? existingCharacter.books;
      const nextBookCategories = normalizeBookCategories(
        'bookCategories' in data ? data.bookCategories : existingCharacter.bookCategories,
        nextBooks
      );
      await this.validateBookCategoryReferences(nextBookCategories);
      const nextBookThumbnails = normalizeBookThumbnailsMap(
        'bookThumbnails' in data ? data.bookThumbnails : relocatedCharacter.bookThumbnails,
        nextBooks
      );

      // Create updated character
      const updatedCharacter: Character = {
        ...relocatedCharacter,
        name: data.name ?? existingCharacter.name,
        aliases: 'aliases' in data ? normalizeAliases(data.aliases) : existingCharacter.aliases,
        category: data.category ?? existingCharacter.category,
        tags: data.tags ?? existingCharacter.tags,
        books: nextBooks,
        bookCategories: nextBookCategories,
        thumbnails: 'thumbnails' in data
          ? normalizeThumbnailsMap(data.thumbnails)
          : relocatedCharacter.thumbnails,
        bookThumbnails: nextBookThumbnails,
        prompts: data.prompts !== undefined ? normalizePrompts(data.prompts) : existingCharacter.prompts,
        content: data.content !== undefined ? data.content : existingCharacter.content,
        modified: new Date(),
        relativePath: newRelativePath,
        filePath: newFilePath,
      };

      // Save updated character to file
      await this.saveCharacterToFile(updatedCharacter);

      // Thumbnail path changes must invalidate the persistent data URL cache.
      if (
        ('thumbnails' in data && !thumbnailsMapsEqual(data.thumbnails, existingCharacter.thumbnails)) ||
        ('bookThumbnails' in data && !bookThumbnailsMapsEqual(data.bookThumbnails, existingCharacter.bookThumbnails))
      ) {
        this.removeCachedThumbnailsForCharacter(existingCharacter.id);
      }

      // Update in-memory list
      const updatedCharacters = [...characters];
      updatedCharacters[index] = updatedCharacter;
      const sortedCharacters = updatedCharacters.sort((a, b) =>
        isDraft
          ? b.modified.getTime() - a.modified.getTime()
          : a.name.localeCompare(b.name)
      );
      sourceSubject.next(sortedCharacters);

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
      const isDraft = !!this.getDraftById(id);
      const sourceSubject = isDraft ? this.draftsSubject : this.charactersSubject;
      const characters = sourceSubject.value;
      const character = this.findRecord(id);

      if (!character) {
        return false;
      }

      const deleteResult = isFolderBasedCharacterPath(character.relativePath)
        ? await this.electronService.deleteDirectoryRecursive(pathDirname(character.filePath))
        : await this.electronService.deleteFile(character.filePath);
      if (!deleteResult.success) {
        throw new Error(`Failed to delete character: ${deleteResult.error}`);
      }

      this.removeCachedThumbnailsForCharacter(character.id);

      // Update in-memory list
      const filteredCharacters = characters.filter((char) => char.id !== character.id);
      sourceSubject.next(filteredCharacters);

      if (!isDraft) {
        try {
          await this.metadataService.removeCharacterFromBookPovs(character.id);
        } catch (cleanupError) {
          this.logger.error('Failed to remove deleted character from book PoV lists', cleanupError);
        }
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
      const isDraft = !!this.getDraftById(id);
      const sourceSubject = isDraft ? this.draftsSubject : this.charactersSubject;
      const characters = sourceSubject.value;
      const existingCharacter = this.findRecord(id);

      if (!existingCharacter) {
        return null;
      }

      // Check if file still exists
      const fileExists = await this.electronService.fileExists(existingCharacter.filePath);
      if (!fileExists) {
        // File was deleted externally, remove from memory
        const filteredCharacters = characters.filter((char) => char.id !== existingCharacter.id);
        sourceSubject.next(filteredCharacters);
        return null;
      }

      // Reload character from file
      const loaded = await this.loadCharacterFromFile(
        existingCharacter.filePath,
        existingCharacter.relativePath,
        parseCharacterMainFileLocation(existingCharacter.relativePath)?.draft
      );
      if (!loaded) {
        return null;
      }

      const refreshedCharacter = loaded.character;
      if (loaded.assignedId) {
        refreshedCharacter.id = existingCharacter.id;
      }

      // An external edit may explicitly promote/demote a record by changing
      // `draft`. Repartition both public collections instead of leaving the
      // record in the collection it occupied before the edit.
      if (!!refreshedCharacter.draft !== isDraft) {
        await this.forceReloadCharacters();
        return this.findRecord(refreshedCharacter.id) || null;
      }

      // Update in-memory list
      const index = characters.findIndex((char) => char.id === existingCharacter.id);
      if (index !== -1) {
        const updatedCharacters = [...characters];
        updatedCharacters[index] = refreshedCharacter;
        const sortedCharacters = updatedCharacters.sort((a, b) =>
          isDraft
            ? b.modified.getTime() - a.modified.getTime()
            : a.name.localeCompare(b.name)
        );
        sourceSubject.next(sortedCharacters);
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
        id: character.id,
        // Folder-based drafts are identified by `@drafts`, not duplicated in metadata.
        ...(character.draft && !isFolderBasedCharacterPath(character.relativePath)
          ? { draft: true }
          : {}),
        name: character.name,
        ...(character.aliases && character.aliases.length > 0
          ? { aliases: character.aliases }
          : {}),
        category: character.category,
        tags: character.tags,
        books: character.books,
        ...(character.bookCategories && Object.keys(character.bookCategories).length > 0
          ? { bookCategories: character.bookCategories }
          : {}),
        ...(character.thumbnails && Object.keys(character.thumbnails).length > 0
          ? { thumbnails: character.thumbnails }
          : {}),
        ...(character.bookThumbnails && Object.keys(character.bookThumbnails).length > 0
          ? { bookThumbnails: character.bookThumbnails }
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

    if (!event.filename.toLowerCase().endsWith('.md')) {
      return;
    }

    try {
      const charactersPath = this.projectService.getCharactersFolderPath();
      if (!event.path.startsWith(charactersPath)) {
        return;
      }

      const activeCharacters = this.charactersSubject.value;
      const drafts = this.draftsSubject.value;
      const character = [...activeCharacters, ...drafts].find(
        (char) => char.filePath === event.path
      );
      const normalizedRoot = charactersPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const relativePath = event.path
        .replace(/\\/g, '/')
        .slice(normalizedRoot.length)
        .replace(/^\/+/, '');
      const isPotentialMainFile =
        !!parseCharacterMainFileLocation(relativePath) || isLegacyCharacterMainFile(relativePath);

      if (event.type === 'unlink') {
        if (character) {
          if (character.draft) {
            this.draftsSubject.next(drafts.filter((char) => char.filePath !== event.path));
          } else {
            this.charactersSubject.next(
              activeCharacters.filter((char) => char.filePath !== event.path)
            );
          }
          this.logger.log(`Character removed: ${character.name}`);
        }
      } else if (event.type === 'change' || event.type === 'add') {
        if (character) {
          await this.refreshCharacter(character.id);
          this.logger.log(`Character reloaded: ${character.name}`);
        } else if (isPotentialMainFile) {
          await this.forceReloadCharacters();
          this.logger.log('Characters reloaded due to new file');
        }
      }
    } catch (error) {
      this.logger.error('Error handling file change', error);
    }
  }

  getCachedThumbnail(characterId: string, styleId?: string, bookId?: string): string | null {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    return this.thumbnailDataUrls.get(thumbnailCacheKey(characterId, style, bookId)) || null;
  }

  /**
   * Loads a character's thumbnail for a style from disk and caches it.
   * Resolves Obsidian wiki-link format [[img/path.png]] or plain paths.
   * Returns null when the style has no thumbnail set (caller should show placeholder).
   */
  async loadThumbnailForCharacter(
    character: Character,
    styleId?: string,
    bookId?: string
  ): Promise<string | null> {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    const raw = resolveThumbnailForBookStyle(
      character.thumbnails,
      character.bookThumbnails,
      bookId,
      style
    );
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
    const absolutePath = resolveThumbnailPath(
      project.path,
      parsed,
      isFolderBasedCharacterPath(character.relativePath)
        ? pathDirname(character.filePath)
        : undefined
    );
    try {
      const dataUrl = await this.electronService.getImageAsDataUrl(absolutePath);
      if (dataUrl) {
        const modTime = character.modified?.toISOString() ?? '';
        this.setCachedThumbnail(character.id, style, dataUrl, modTime, bookId);
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
  async loadThumbnailsForCharacters(
    characters: Character[],
    styleId?: string,
    bookId?: string
  ): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return;
    }
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    const toLoad = characters.filter((c) => {
      const raw = resolveThumbnailForBookStyle(c.thumbnails, c.bookThumbnails, bookId, style);
      return !!raw && !this.thumbnailDataUrls.has(thumbnailCacheKey(c.id, style, bookId));
    });
    await Promise.all(toLoad.map((char) => this.loadThumbnailForCharacter(char, style, bookId)));
  }

  setCachedThumbnail(
    characterId: string,
    styleId: string,
    dataUrl: string,
    modificationTime: string,
    bookId?: string
  ): void {
    const key = thumbnailCacheKey(characterId, styleId, bookId);
    this.thumbnailDataUrls.set(key, dataUrl);
    this.thumbnailModificationTimes.set(key, modificationTime);
  }

  getCachedThumbnailModTime(characterId: string, styleId?: string, bookId?: string): string | null {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    return this.thumbnailModificationTimes.get(thumbnailCacheKey(characterId, style, bookId)) || null;
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
  getAllCachedThumbnails(styleId?: string, bookId?: string): Map<string, string> {
    const style = styleId || this.projectService.getDefaultCharacterStyle();
    const result = new Map<string, string>();
    const suffix = bookId ? `:${bookId}:${style}` : `:${style}`;
    for (const [key, value] of this.thumbnailDataUrls) {
      // Book-specific cache entries also end with :style; exclude them from the
      // main-context map so switching back from a book cannot show the wrong image.
      if (!bookId && key.split(':').length !== 2) continue;
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

function bookThumbnailsMapsEqual(
  a: Record<string, Record<string, string>> | undefined | null,
  b: Record<string, Record<string, string>> | undefined | null
): boolean {
  return JSON.stringify(normalizeBookThumbnailsMap(a) || {}) ===
    JSON.stringify(normalizeBookThumbnailsMap(b) || {});
}
