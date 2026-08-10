import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { Character, CharacterFormData } from '../interfaces/character.interface';
import { Book, Cast, Category, ProjectMetadata, ProjectSettings, Saga, Series, Tag } from '../interfaces/project.interface';
import { ValidationResult } from '../interfaces/validation.interface';
import { CharacterValidator } from '../validators/character.validator';
import { ProjectValidator } from '../validators/project.validator';
import { pathJoin } from '../utils/path.utils';
import { slugify } from '../utils/slug.utils';
import { parseMarkdown, generateMarkdown } from '../utils/markdown.utils';
import {
  getBookDisplayName,
  normalizeBookCode,
  normalizeBookName,
} from '../utils/book-display.utils';
import { BookPlacement, booksInPlacement } from '../utils/library-grouping.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { CastService } from './cast.service';
import { LoggingService } from './logging.service';
import { requireProject } from '../utils/project.utils';

@Injectable({
  providedIn: 'root',
})
export class MetadataService {
  private metadataSubject = new BehaviorSubject<ProjectMetadata | null>(null);
  public metadata$ = this.metadataSubject.asObservable();
  private currentProjectPath: string | null = null;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private castService: CastService,
    private logger: LoggingService
  ) {
    // Subscribe to project changes to keep metadata in sync
    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      if (project) {
        this.metadataSubject.next(project.metadata);
        this.currentProjectPath = project.path;
      } else {
        this.metadataSubject.next(null);
        this.currentProjectPath = null;
      }
    });
  }

  /**
   * Gets the current metadata
   */
  getCurrentMetadata(): ProjectMetadata | null {
    return this.metadataSubject.value;
  }

  /**
   * Loads metadata from the specified project path via ProjectService
   */
  async loadMetadata(projectPath: string): Promise<ProjectMetadata> {
    try {
      this.currentProjectPath = projectPath;

      // Get metadata from the current project loaded in ProjectService
      const project = this.projectService.getCurrentProject();
      if (!project || project.path !== projectPath) {
        throw new Error('Project not loaded in ProjectService');
      }

      const metadata = project.metadata;

      // Validate metadata structure
      const validation = ProjectValidator.validateProjectMetadata(metadata);
      if (!validation.isValid) {
        const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
        throw new Error(`Invalid metadata structure: ${errorMessages}`);
      }

      this.metadataSubject.next(metadata);
      return metadata;
    } catch (error) {
      this.logger.error('Failed to load metadata', error);
      throw new Error(`Failed to load metadata: ${error}`);
    }
  }

  /**
   * Saves metadata via ProjectService (updates ensemble.json)
   */
  async saveMetadata(metadata: ProjectMetadata): Promise<void> {
    requireProject(this.projectService.getCurrentProject());

    try {
      // Validate metadata before saving
      const validation = ProjectValidator.validateProjectMetadata(metadata);
      if (!validation.isValid) {
        const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
        throw new Error(`Invalid metadata: ${errorMessages}`);
      }

      // Use ProjectService to update metadata (which saves to ensemble.json)
      await this.projectService.updateMetadata(metadata);

      this.metadataSubject.next(metadata);
    } catch (error) {
      this.logger.error('Failed to save metadata', error);
      throw new Error(`Failed to save metadata: ${error}`);
    }
  }

  // Category Management

  /**
   * Gets all categories from current metadata
   */
  getCategories(): Category[] {
    const metadata = this.metadataSubject.value;
    return metadata?.categories || [];
  }

  /**
   * Gets a category by ID
   */
  getCategoryById(id: string): Category | undefined {
    const categories = this.getCategories();
    return categories.find((cat) => cat.id === id);
  }

  /**
   * Adds a new category
   */
  async addCategory(categoryData: Omit<Category, 'id'>): Promise<Category> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Generate unique ID
    const id = slugify(categoryData.name);
    const newCategory: Category = { id, ...categoryData };

    // Validate the new category
    const validation = ProjectValidator.validateCategory(newCategory);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid category: ${errorMessages}`);
    }

    // Check for duplicate ID
    const existingCategory = metadata.categories.find((cat) => cat.id === id);
    if (existingCategory) {
      throw new Error(`Category with ID '${id}' already exists`);
    }

    // Add category and save
    const updatedMetadata = {
      ...metadata,
      categories: [...metadata.categories, newCategory],
    };

    await this.saveMetadata(updatedMetadata);
    return newCategory;
  }

  /**
   * Updates an existing category
   */
  async updateCategory(id: string, updates: Partial<Omit<Category, 'id'>>): Promise<Category> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const categoryIndex = metadata.categories.findIndex((cat) => cat.id === id);
    if (categoryIndex === -1) {
      throw new Error(`Category with ID '${id}' not found`);
    }

    const updatedCategory = { ...metadata.categories[categoryIndex], ...updates };

    // Validate the updated category
    const validation = ProjectValidator.validateCategory(updatedCategory);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid category: ${errorMessages}`);
    }

    // Update category and save
    const updatedCategories = [...metadata.categories];
    updatedCategories[categoryIndex] = updatedCategory;

    const updatedMetadata = {
      ...metadata,
      categories: updatedCategories,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedCategory;
  }

  /**
   * Removes a category
   */
  async removeCategory(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const categoryExists = metadata.categories.some((cat) => cat.id === id);
    if (!categoryExists) {
      throw new Error(`Category with ID '${id}' not found`);
    }

    // Check if this is the default category
    if (metadata.settings.defaultCategory === id) {
      throw new Error('Cannot remove the default category. Please set a different default category first.');
    }

    // Remove category and save
    const updatedMetadata = {
      ...metadata,
      categories: metadata.categories.filter((cat) => cat.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  // Tag Management

  /**
   * Gets all tags from current metadata
   */
  getTags(): Tag[] {
    const metadata = this.metadataSubject.value;
    return metadata?.tags || [];
  }

  /**
   * Gets a tag by ID
   */
  getTagById(id: string): Tag | undefined {
    const tags = this.getTags();
    return tags.find((tag) => tag.id === id);
  }

  /**
   * Adds a new tag
   */
  async addTag(tagData: Omit<Tag, 'id'>): Promise<Tag> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Generate unique ID
    const id = slugify(tagData.name);
    const newTag: Tag = { id, ...tagData };

    // Validate the new tag
    const validation = ProjectValidator.validateTag(newTag);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid tag: ${errorMessages}`);
    }

    // Check for duplicate ID
    const existingTag = metadata.tags.find((tag) => tag.id === id);
    if (existingTag) {
      throw new Error(`Tag with ID '${id}' already exists`);
    }

    // Add tag and save
    const updatedMetadata = {
      ...metadata,
      tags: [...metadata.tags, newTag],
    };

    await this.saveMetadata(updatedMetadata);
    return newTag;
  }

  /**
   * Updates an existing tag
   */
  async updateTag(id: string, updates: Partial<Omit<Tag, 'id'>>): Promise<Tag> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const tagIndex = metadata.tags.findIndex((tag) => tag.id === id);
    if (tagIndex === -1) {
      throw new Error(`Tag with ID '${id}' not found`);
    }

    const updatedTag = { ...metadata.tags[tagIndex], ...updates };

    // Validate the updated tag
    const validation = ProjectValidator.validateTag(updatedTag);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid tag: ${errorMessages}`);
    }

    // Update tag and save
    const updatedTags = [...metadata.tags];
    updatedTags[tagIndex] = updatedTag;

    const updatedMetadata = {
      ...metadata,
      tags: updatedTags,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedTag;
  }

  /**
   * Removes a tag
   */
  async removeTag(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const tagExists = metadata.tags.some((tag) => tag.id === id);
    if (!tagExists) {
      throw new Error(`Tag with ID '${id}' not found`);
    }

    // Remove tag and save
    const updatedMetadata = {
      ...metadata,
      tags: metadata.tags.filter((tag) => tag.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  // Cast Management

  /**
   * Gets all casts from current metadata
   */
  getCasts(): Cast[] {
    const metadata = this.metadataSubject.value;
    return metadata?.casts || [];
  }

  /**
   * Gets a cast by ID
   */
  getCastById(id: string): Cast | undefined {
    const casts = this.getCasts();
    return casts.find((cast) => cast.id === id);
  }

  /**
   * Adds a new cast
   * Creates folder structure via CastService and saves metadata
   */
  async addCast(castData: Omit<Cast, 'id'>): Promise<Cast> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize casts array if it doesn't exist (for backward compatibility)
    const casts = metadata.casts || [];

    // Create cast folder structure via CastService
    const newCast = await this.castService.createCast({
      name: castData.name,
      characterIds: castData.characterIds,
      description: castData.description,
    });

    // Save minimal cast metadata to ensemble.json (id, name, characterIds only)
    const castMetadata: Cast = {
      id: newCast.id,
      name: newCast.name,
      characterIds: newCast.characterIds,
    };

    const updatedMetadata = {
      ...metadata,
      casts: [...casts, castMetadata],
    };

    await this.saveMetadata(updatedMetadata);
    return newCast; // Return full cast with folder info
  }

  /**
   * Updates an existing cast
   * Updates folder via CastService and ensemble.json metadata
   */
  async updateCast(id: string, updates: Partial<Omit<Cast, 'id'>>): Promise<Cast> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize casts array if it doesn't exist (for backward compatibility)
    const casts = metadata.casts || [];

    const castIndex = casts.findIndex((cast) => cast.id === id);
    if (castIndex === -1) {
      throw new Error(`Cast with ID '${id}' not found`);
    }

    // Update cast folder via CastService
    const updatedCast = await this.castService.updateCast(id, updates);
    if (!updatedCast) {
      throw new Error('Failed to update cast folder');
    }

    // Update ensemble.json with minimal metadata (id, name, characterIds only)
    const castMetadata: Cast = {
      id: updatedCast.id,
      name: updatedCast.name,
      characterIds: updatedCast.characterIds,
    };

    const updatedCasts = [...casts];
    updatedCasts[castIndex] = castMetadata;

    const updatedMetadata = {
      ...metadata,
      casts: updatedCasts,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedCast; // Return full cast with folder info
  }

  /**
   * Removes a cast
   * Deletes the cast folder via CastService and updates ensemble.json
   */
  async removeCast(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize casts array if it doesn't exist (for backward compatibility)
    const casts = metadata.casts || [];

    const castExists = casts.some((cast) => cast.id === id);
    if (!castExists) {
      throw new Error(`Cast with ID '${id}' not found`);
    }

    // Delete cast folder via CastService
    await this.castService.deleteCast(id);

    // Remove cast from ensemble.json
    const updatedMetadata = {
      ...metadata,
      casts: casts.filter((cast) => cast.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  // Book Management

  /**
   * Gets all books from current metadata
   */
  getBooks(): Book[] {
    const metadata = this.metadataSubject.value;
    return metadata?.books || [];
  }

  /**
   * Gets a book by ID
   */
  getBookById(id: string): Book | undefined {
    const books = this.getBooks();
    return books.find((book) => book.id === id);
  }

  /**
   * Adds a new book
   */
  async addBook(bookData: Omit<Book, 'id'>): Promise<Book> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize books array if it doesn't exist (for backward compatibility)
    const books = metadata.books || [];

    const code = normalizeBookCode(bookData.code);
    const titleInput = bookData.name?.trim() ?? '';
    if (!code && !titleInput) {
      throw new Error('Either book code or title is required');
    }

    const name = normalizeBookName(bookData.name);
    // Prefer code for id when present (stable short identifier); fall back to title
    const id = slugify(code || name);
    if (!id) {
      throw new Error('Either book code or title is required');
    }

    const newBook: Book = {
      ...bookData,
      id,
      name,
      code,
    };
    if (!code) {
      delete newBook.code;
    }
    this.normalizeBookPlacement(newBook, metadata);

    // Validate the new book
    const validation = ProjectValidator.validateBook(newBook);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid book: ${errorMessages}`);
    }

    // Check for duplicate ID
    const existingBook = books.find((book) => book.id === id);
    if (existingBook) {
      throw new Error(`Book with ID '${id}' already exists`);
    }

    this.assertUniqueBookCode(books, code);

    // Add book and save
    const updatedMetadata = {
      ...metadata,
      books: [...books, newBook],
    };

    await this.saveMetadata(updatedMetadata);
    return newBook;
  }

  /**
   * Updates an existing book
   */
  async updateBook(id: string, updates: Partial<Omit<Book, 'id'>>): Promise<Book> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize books array if it doesn't exist (for backward compatibility)
    const books = metadata.books || [];

    const bookIndex = books.findIndex((book) => book.id === id);
    if (bookIndex === -1) {
      throw new Error(`Book with ID '${id}' not found`);
    }

    const merged = { ...books[bookIndex], ...updates };
    const code = normalizeBookCode(
      updates.code !== undefined ? updates.code : merged.code
    );
    const titleInput = (
      updates.name !== undefined ? updates.name : merged.name
    )?.trim() ?? '';
    if (!code && !titleInput) {
      throw new Error('Either book code or title is required');
    }

    const name = normalizeBookName(
      updates.name !== undefined ? updates.name : merged.name
    );

    const updatedBook: Book = {
      ...merged,
      name,
      code,
    };
    if (!code) {
      delete updatedBook.code;
    }
    this.normalizeBookPlacement(updatedBook, metadata);

    // Validate the updated book
    const validation = ProjectValidator.validateBook(updatedBook);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid book: ${errorMessages}`);
    }

    this.assertUniqueBookCode(books, code, id);

    // Update book and save
    const updatedBooks = [...books];
    updatedBooks[bookIndex] = updatedBook;

    const updatedMetadata = {
      ...metadata,
      books: updatedBooks,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedBook;
  }

  private assertUniqueBookCode(
    books: Book[],
    code: string | undefined,
    excludeId?: string
  ): void {
    if (!code) {
      return;
    }
    const normalized = code.toLowerCase();
    const duplicate = books.find(
      (book) =>
        book.id !== excludeId &&
        book.code?.trim().toLowerCase() === normalized
    );
    if (duplicate) {
      throw new Error(`Book code '${code}' is already used by another book`);
    }
  }

  /** Clears empty placement fields and fills seriesId from saga when needed. */
  private normalizeBookPlacement(book: Book, metadata: ProjectMetadata): void {
    const seriesList = metadata.series || [];
    const sagasList = metadata.sagas || [];

    if (book.sagaId) {
      const saga = sagasList.find((s) => s.id === book.sagaId);
      if (saga) {
        book.seriesId = saga.seriesId;
      }
    }

    if (!book.seriesId) {
      delete book.seriesId;
      delete book.sagaId;
    } else if (!seriesList.some((s) => s.id === book.seriesId)) {
      delete book.seriesId;
      delete book.sagaId;
    }

    if (!book.sagaId) {
      delete book.sagaId;
    } else if (!sagasList.some((s) => s.id === book.sagaId && s.seriesId === book.seriesId)) {
      delete book.sagaId;
    }
  }

  /**
   * Removes a character id from every book's povCharacterIds (e.g. after character delete).
   */
  async removeCharacterFromBookPovs(characterId: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      return;
    }

    const books = metadata.books || [];
    let changed = false;
    const updatedBooks = books.map((book) => {
      const ids = book.povCharacterIds;
      if (!ids || !ids.includes(characterId)) {
        return book;
      }
      changed = true;
      return {
        ...book,
        povCharacterIds: ids.filter((id) => id !== characterId),
      };
    });

    if (!changed) {
      return;
    }

    await this.saveMetadata({
      ...metadata,
      books: updatedBooks,
    });
  }

  /**
   * Removes a book and cleans up character references
   */
  async removeBook(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize books array if it doesn't exist (for backward compatibility)
    const books = metadata.books || [];

    const bookExists = books.some((book) => book.id === id);
    if (!bookExists) {
      throw new Error(`Book with ID '${id}' not found`);
    }

    // Clean up character references to this book
    await this.cleanupBookReferencesFromCharacters(id);

    // Remove book and save
    const updatedMetadata = {
      ...metadata,
      books: books.filter((book) => book.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  /**
   * Moves a book to a series/saga/ungrouped shelf and optionally inserts it
   * at a local index among peers of that shelf (rewriting books[] order).
   */
  async moveBook(
    bookId: string,
    placement: BookPlacement,
    insertIndex?: number
  ): Promise<Book> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const books = [...(metadata.books || [])];
    const bookIndex = books.findIndex((book) => book.id === bookId);
    if (bookIndex === -1) {
      throw new Error(`Book with ID '${bookId}' not found`);
    }

    const seriesList = metadata.series || [];
    const sagasList = metadata.sagas || [];

    let seriesId = placement.seriesId;
    let sagaId = placement.sagaId;

    if (sagaId) {
      const saga = sagasList.find((s) => s.id === sagaId);
      if (!saga) {
        throw new Error(`Saga with ID '${sagaId}' not found`);
      }
      seriesId = saga.seriesId;
    } else if (seriesId) {
      if (!seriesList.some((s) => s.id === seriesId)) {
        throw new Error(`Series with ID '${seriesId}' not found`);
      }
      sagaId = undefined;
    } else {
      seriesId = undefined;
      sagaId = undefined;
    }

    const book = { ...books[bookIndex] };
    if (seriesId) {
      book.seriesId = seriesId;
    } else {
      delete book.seriesId;
    }
    if (sagaId) {
      book.sagaId = sagaId;
    } else {
      delete book.sagaId;
    }

    books.splice(bookIndex, 1);

    const targetPlacement: BookPlacement = { seriesId, sagaId };
    const peers = booksInPlacement(books, targetPlacement);
    let localIndex =
      insertIndex === undefined ? peers.length : Math.max(0, Math.min(insertIndex, peers.length));

    let globalInsertIndex: number;
    if (peers.length === 0 || localIndex >= peers.length) {
      if (peers.length === 0) {
        globalInsertIndex = books.length;
      } else {
        const lastPeerId = peers[peers.length - 1].id;
        globalInsertIndex = books.findIndex((b) => b.id === lastPeerId) + 1;
      }
    } else {
      const peerId = peers[localIndex].id;
      globalInsertIndex = books.findIndex((b) => b.id === peerId);
    }

    books.splice(globalInsertIndex, 0, book);

    const updatedMetadata = {
      ...metadata,
      books,
      series: seriesList,
      sagas: sagasList,
    };

    const validation = ProjectValidator.validateProjectMetadata(updatedMetadata);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid book placement: ${errorMessages}`);
    }

    await this.saveMetadata(updatedMetadata);
    return book;
  }

  // Series Management

  getSeries(): Series[] {
    const metadata = this.metadataSubject.value;
    return metadata?.series || [];
  }

  getSeriesById(id: string): Series | undefined {
    return this.getSeries().find((s) => s.id === id);
  }

  async addSeries(seriesData: Omit<Series, 'id'>): Promise<Series> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const seriesList = metadata.series || [];
    const id = slugify(seriesData.name);
    if (!id) {
      throw new Error('Series name is required');
    }

    const newSeries: Series = { id, ...seriesData };
    const validation = ProjectValidator.validateSeries(newSeries);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid series: ${errorMessages}`);
    }

    if (seriesList.some((s) => s.id === id)) {
      throw new Error(`Series with ID '${id}' already exists`);
    }

    await this.saveMetadata({
      ...metadata,
      series: [...seriesList, newSeries],
      sagas: metadata.sagas || [],
    });
    return newSeries;
  }

  async updateSeries(id: string, updates: Partial<Omit<Series, 'id'>>): Promise<Series> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const seriesList = [...(metadata.series || [])];
    const index = seriesList.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Series with ID '${id}' not found`);
    }

    const updatedSeries = { ...seriesList[index], ...updates };
    const validation = ProjectValidator.validateSeries(updatedSeries);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid series: ${errorMessages}`);
    }

    seriesList[index] = updatedSeries;
    await this.saveMetadata({
      ...metadata,
      series: seriesList,
    });
    return updatedSeries;
  }

  async removeSeries(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const seriesList = metadata.series || [];
    if (!seriesList.some((s) => s.id === id)) {
      throw new Error(`Series with ID '${id}' not found`);
    }

    const sagasList = (metadata.sagas || []).filter((s) => s.seriesId !== id);
    const books = (metadata.books || []).map((book) => {
      if (book.seriesId !== id) {
        return book;
      }
      const next = { ...book };
      delete next.seriesId;
      delete next.sagaId;
      return next;
    });

    await this.saveMetadata({
      ...metadata,
      series: seriesList.filter((s) => s.id !== id),
      sagas: sagasList,
      books,
    });
  }

  async reorderSeries(orderedIds: string[]): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const seriesList = metadata.series || [];
    if (orderedIds.length !== seriesList.length) {
      throw new Error('Series reorder list length mismatch');
    }

    const byId = new Map(seriesList.map((s) => [s.id, s]));
    const reordered: Series[] = [];
    for (const id of orderedIds) {
      const item = byId.get(id);
      if (!item) {
        throw new Error(`Series with ID '${id}' not found`);
      }
      reordered.push(item);
    }

    await this.saveMetadata({
      ...metadata,
      series: reordered,
    });
  }

  // Saga Management

  getSagas(): Saga[] {
    const metadata = this.metadataSubject.value;
    return metadata?.sagas || [];
  }

  getSagaById(id: string): Saga | undefined {
    return this.getSagas().find((s) => s.id === id);
  }

  async addSaga(sagaData: Omit<Saga, 'id'>): Promise<Saga> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const seriesList = metadata.series || [];
    if (!seriesList.some((s) => s.id === sagaData.seriesId)) {
      throw new Error(`Series with ID '${sagaData.seriesId}' not found`);
    }

    const sagasList = metadata.sagas || [];
    const id = slugify(sagaData.name);
    if (!id) {
      throw new Error('Saga name is required');
    }

    const newSaga: Saga = { id, ...sagaData };
    const validation = ProjectValidator.validateSaga(newSaga);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid saga: ${errorMessages}`);
    }

    if (sagasList.some((s) => s.id === id)) {
      throw new Error(`Saga with ID '${id}' already exists`);
    }

    await this.saveMetadata({
      ...metadata,
      series: seriesList,
      sagas: [...sagasList, newSaga],
    });
    return newSaga;
  }

  async updateSaga(id: string, updates: Partial<Omit<Saga, 'id'>>): Promise<Saga> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const sagasList = [...(metadata.sagas || [])];
    const index = sagasList.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Saga with ID '${id}' not found`);
    }

    const updatedSaga = { ...sagasList[index], ...updates };
    const seriesList = metadata.series || [];
    if (!seriesList.some((s) => s.id === updatedSaga.seriesId)) {
      throw new Error(`Series with ID '${updatedSaga.seriesId}' not found`);
    }

    const validation = ProjectValidator.validateSaga(updatedSaga);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid saga: ${errorMessages}`);
    }

    // If saga moves to another series, update book seriesIds that reference this saga
    const previous = sagasList[index];
    let books = metadata.books || [];
    if (previous.seriesId !== updatedSaga.seriesId) {
      books = books.map((book) => {
        if (book.sagaId !== id) {
          return book;
        }
        return { ...book, seriesId: updatedSaga.seriesId };
      });
    }

    sagasList[index] = updatedSaga;
    await this.saveMetadata({
      ...metadata,
      sagas: sagasList,
      books,
    });
    return updatedSaga;
  }

  async removeSaga(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const sagasList = metadata.sagas || [];
    if (!sagasList.some((s) => s.id === id)) {
      throw new Error(`Saga with ID '${id}' not found`);
    }

    const books = (metadata.books || []).map((book) => {
      if (book.sagaId !== id) {
        return book;
      }
      const next = { ...book };
      delete next.sagaId;
      return next;
    });

    await this.saveMetadata({
      ...metadata,
      sagas: sagasList.filter((s) => s.id !== id),
      books,
    });
  }

  async reorderSagas(orderedIds: string[]): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const sagasList = metadata.sagas || [];
    if (orderedIds.length !== sagasList.length) {
      throw new Error('Saga reorder list length mismatch');
    }

    const byId = new Map(sagasList.map((s) => [s.id, s]));
    const reordered: Saga[] = [];
    for (const id of orderedIds) {
      const item = byId.get(id);
      if (!item) {
        throw new Error(`Saga with ID '${id}' not found`);
      }
      reordered.push(item);
    }

    await this.saveMetadata({
      ...metadata,
      sagas: reordered,
    });
  }

  /**
   * Reorders sagas within a single series while preserving other series' saga order.
   */
  async reorderSagasInSeries(seriesId: string, orderedIdsInSeries: string[]): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const sagasList = metadata.sagas || [];
    const inSeries = sagasList.filter((s) => s.seriesId === seriesId);
    if (orderedIdsInSeries.length !== inSeries.length) {
      throw new Error('Saga reorder list length mismatch for series');
    }

    const byId = new Map(inSeries.map((s) => [s.id, s]));
    const reorderedInSeries: Saga[] = [];
    for (const id of orderedIdsInSeries) {
      const item = byId.get(id);
      if (!item) {
        throw new Error(`Saga with ID '${id}' not found in series '${seriesId}'`);
      }
      reorderedInSeries.push(item);
    }

    let cursor = 0;
    const reordered = sagasList.map((saga) => {
      if (saga.seriesId !== seriesId) {
        return saga;
      }
      return reorderedInSeries[cursor++];
    });

    await this.saveMetadata({
      ...metadata,
      sagas: reordered,
    });
  }

  // Settings Management

  /**
   * Gets current project settings
   */
  getSettings(): ProjectSettings | null {
    const metadata = this.metadataSubject.value;
    return metadata?.settings || null;
  }

  /**
   * Updates project settings
   */
  async updateSettings(updates: Partial<ProjectSettings>): Promise<ProjectSettings> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const updatedSettings = {
      ...metadata.settings,
      ...updates,
    } as ProjectSettings & { autoSave?: unknown; fileWatchEnabled?: unknown };
    delete updatedSettings.autoSave;
    delete updatedSettings.fileWatchEnabled;

    // Validate the updated settings
    const validation = ProjectValidator.validateProjectSettings(updatedSettings);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid settings: ${errorMessages}`);
    }

    // If defaultCategory is being updated, validate it exists
    if (updates.defaultCategory) {
      const categoryExists = metadata.categories.some((cat) => cat.id === updates.defaultCategory);
      if (!categoryExists) {
        throw new Error(`Default category '${updates.defaultCategory}' does not exist`);
      }
    }

    // Update settings and save
    const updatedMetadata = {
      ...metadata,
      settings: updatedSettings,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedSettings;
  }

  // Validation Methods

  /**
   * Validates character data against current metadata
   */
  validateCharacterAgainstMetadata(character: Character): ValidationResult {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      return {
        isValid: false,
        errors: [
          {
            field: 'metadata',
            message: 'No metadata loaded',
            code: 'NO_METADATA',
          },
        ],
      };
    }

    return CharacterValidator.validateAgainstMetadata(character, metadata);
  }

  /**
   * Validates character form data against current metadata
   */
  validateCharacterFormDataAgainstMetadata(formData: CharacterFormData): ValidationResult {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      return {
        isValid: false,
        errors: [
          {
            field: 'metadata',
            message: 'No metadata loaded',
            code: 'NO_METADATA',
          },
        ],
      };
    }

    const errors = [];

    // Validate category exists in metadata
    if (formData.category) {
      const categoryExists = metadata.categories.some((cat) => cat.id === formData.category);
      if (!categoryExists) {
        errors.push({
          field: 'category',
          message: `Category '${formData.category}' does not exist in project metadata`,
          code: 'INVALID_REFERENCE',
        });
      }
    }

    // Validate tags exist in metadata
    if (Array.isArray(formData.tags)) {
      formData.tags.forEach((tagId) => {
        const tagExists = metadata.tags.some((tag) => tag.id === tagId);
        if (!tagExists) {
          errors.push({
            field: 'tags',
            message: `Tag '${tagId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        }
      });
    }

    // Validate books exist in metadata
    if (Array.isArray(formData.books)) {
      formData.books.forEach((bookId) => {
        const bookExists = metadata.books && metadata.books.some((book) => book.id === bookId);
        if (!bookExists) {
          errors.push({
            field: 'books',
            message: `Book '${bookId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        }
      });
    }

    // Validate book category overrides
    if (formData.bookCategories && typeof formData.bookCategories === 'object') {
      const bookIds = new Set((metadata.books || []).map((book) => book.id));
      const categoryIds = new Set(metadata.categories.map((cat) => cat.id));
      const assignedBooks = new Set(formData.books || []);

      for (const [bookId, categoryId] of Object.entries(formData.bookCategories)) {
        if (!bookIds.has(bookId)) {
          errors.push({
            field: 'bookCategories',
            message: `Book '${bookId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        } else if (!assignedBooks.has(bookId)) {
          errors.push({
            field: 'bookCategories',
            message: `Book category override for '${bookId}' is not in the character's books list`,
            code: 'INVALID_REFERENCE',
          });
        }
        if (!categoryIds.has(categoryId)) {
          errors.push({
            field: 'bookCategories',
            message: `Category '${categoryId}' for book '${bookId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gets available category options for character forms
   */
  getCategoryOptions(): { id: string; name: string; color: string }[] {
    return this.getCategories().map((cat) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
    }));
  }

  /**
   * Gets available tag options for character forms
   */
  getTagOptions(): { id: string; name: string; color: string }[] {
    return this.getTags().map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    }));
  }

  /**
   * Gets available book options for character forms
   */
  getBookOptions(): { id: string; name: string; color: string }[] {
    return this.getBooks().map((book) => ({
      id: book.id,
      name: getBookDisplayName(book),
      color: book.color,
    }));
  }

  /**
   * Gets the default category ID
   */
  getDefaultCategoryId(): string | null {
    const settings = this.getSettings();
    return settings?.defaultCategory || null;
  }

  // Utility Methods

  /**
   * Cleans up references to a book from all character files
   */
  private async cleanupBookReferencesFromCharacters(bookId: string): Promise<void> {
    if (!this.currentProjectPath) {
      return;
    }

    try {
      const charactersPath = this.projectService.getCharactersFolderPath();
      const scanResult = await this.electronService.readDirectoryRecursive(charactersPath, '_*.md');
      
      if (!scanResult.success || !scanResult.files) {
        this.logger.warn('Failed to list character files:', scanResult.error);
        return;
      }
      
      for (const { absolutePath: filePath } of scanResult.files) {
        const readResult = await this.electronService.readFile(filePath);
        
        if (!readResult.success || !readResult.content) {
          this.logger.warn(`Failed to read character file ${filePath}:`, readResult.error);
          continue;
        }
        
        // Parse frontmatter to check if this character references the book
        const parsed = parseMarkdown(readResult.content);
        if (!parsed.success || !parsed.data) {
          this.logger.warn(`Failed to parse character file ${filePath}:`, parsed.error);
          continue;
        }
        const frontmatter = parsed.data.frontmatter as Record<string, any>;
        
        const books = frontmatter['books'];
        if (books && Array.isArray(books) && books.includes(bookId)) {
          // Remove the book reference
          const updatedBooks = books.filter((id: string) => id !== bookId);
          const updatedFrontmatter = { ...frontmatter, books: updatedBooks };
          
          // Update the file
          const updatedContent = generateMarkdown(updatedFrontmatter, parsed.data.content);
          const writeResult = await this.electronService.writeFileAtomic(filePath, updatedContent);
          
          if (!writeResult.success) {
            this.logger.warn(`Failed to update character file ${filePath}:`, writeResult.error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup book references from characters', error);
      // Don't throw here as we still want to remove the book from metadata
    }
  }

  /**
   * Parses frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { frontmatter: any; body: string } {
    const lines = content.split('\n');
    
    if (lines[0] !== '---') {
      return { frontmatter: {}, body: content };
    }

    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      return { frontmatter: {}, body: content };
    }

    const frontmatterLines = lines.slice(1, endIndex);
    const body = lines.slice(endIndex + 1).join('\n');
    
    // Simple YAML parsing for our use case
    const frontmatter: any = {};
    for (const line of frontmatterLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      
      // Handle arrays (simple case for books and tags)
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        if (arrayContent.trim()) {
          frontmatter[key] = arrayContent.split(',').map(item => item.trim().replace(/['"]/g, ''));
        } else {
          frontmatter[key] = [];
        }
      } else {
        // Remove quotes if present
        frontmatter[key] = value.replace(/^["']|["']$/g, '');
      }
    }

    return { frontmatter, body };
  }

  /**
   * Generates markdown content with updated frontmatter
   */
  private generateMarkdownWithFrontmatter(frontmatter: any, originalContent: string): string {
    const lines = originalContent.split('\n');
    
    // Find the end of existing frontmatter
    let endIndex = -1;
    if (lines[0] === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') {
          endIndex = i;
          break;
        }
      }
    }

    // Get the body content (everything after frontmatter)
    const body = endIndex !== -1 ? lines.slice(endIndex + 1).join('\n') : originalContent;

    // Generate new frontmatter
    const frontmatterLines = ['---'];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        const arrayStr = value.length > 0 ? `[${value.map(v => `"${v}"`).join(', ')}]` : '[]';
        frontmatterLines.push(`${key}: ${arrayStr}`);
      } else {
        frontmatterLines.push(`${key}: "${value}"`);
      }
    }
    frontmatterLines.push('---');

    return frontmatterLines.join('\n') + '\n' + body;
  }

  /**
   * Resets the service state (useful for testing or project switching)
   */
  reset(): void {
    this.metadataSubject.next(null);
    this.currentProjectPath = null;
  }
}
