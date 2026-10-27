import { Injectable } from '@angular/core';
import { Book } from '../interfaces/project.interface';
import { BookPlanSettings } from '../interfaces/book-plan.interface';
import { getBookDisplayName } from '../utils/book-display.utils';
import { MetadataService } from './metadata.service';
import { ModalService } from './modal.service';

/** Values emitted by the Edit Book modal (`BookEditorComponent`). */
export interface BookFormData {
  name: string;
  code?: string;
  color: string;
  description?: string;
  status?: 'draft' | 'in-progress' | 'complete' | 'published' | 'on-hold' | 'archived';
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
  povCharacterIds?: string[];
  seriesId?: string;
  sagaId?: string;
  /** Plan file, relative to the project root. Empty clears the plan. */
  planPath?: string;
  /** Manuscript chapter folder, relative to the project root. */
  manuscriptDir?: string;
}

const STATUS_MAP: Record<string, Book['status']> = {
  draft: 'draft',
  'in-progress': 'in-progress',
  published: 'published',
  archived: 'archived',
  complete: 'published',
  'on-hold': 'archived',
};

/**
 * Create / update / delete books from the Edit Book modal.
 * Shared by the Library and the book (plan) page so both hosts behave the same.
 */
@Injectable({
  providedIn: 'root',
})
export class BookEditActionsService {
  constructor(
    private metadataService: MetadataService,
    private modalService: ModalService
  ) {}

  /** Creates a book when `editing` is null, otherwise updates it. Throws on failure. */
  async save(editing: Book | null, data: BookFormData): Promise<Book> {
    const seriesId = data.seriesId || undefined;
    const sagaId = seriesId ? data.sagaId || undefined : undefined;
    const planPath = data.planPath?.trim();
    const manuscriptDir = data.manuscriptDir?.trim();
    const plan: BookPlanSettings | undefined = planPath
      ? { path: planPath, ...(manuscriptDir ? { manuscriptDir } : {}) }
      : undefined;

    const payload: Omit<Book, 'id'> = {
      name: data.name,
      code: data.code,
      color: data.color,
      description: data.description,
      status: data.status ? STATUS_MAP[data.status] : undefined,
      publicationDate: data.publicationDate,
      isbn: data.isbn,
      coverImage: data.coverImage,
      povCharacterIds: data.povCharacterIds ?? [],
      seriesId,
      sagaId,
      plan,
    };

    if (!editing) {
      return this.metadataService.addBook(payload);
    }

    const updated = await this.metadataService.updateBook(editing.id, payload);
    if ((editing.seriesId || undefined) !== seriesId || (editing.sagaId || undefined) !== sagaId) {
      await this.metadataService.moveBook(editing.id, { seriesId, sagaId }, undefined);
    }
    return updated;
  }

  /** Asks for confirmation, then deletes the book. Returns false when cancelled. */
  async confirmAndDelete(book: Book): Promise<boolean> {
    if (
      !(await this.modalService.confirm(
        `Are you sure you want to delete the book "${getBookDisplayName(book)}"?\n\nThis will remove the book from all characters that reference it. Characters themselves will not be deleted.`
      ))
    ) {
      return false;
    }
    await this.metadataService.removeBook(book.id);
    return true;
  }
}
