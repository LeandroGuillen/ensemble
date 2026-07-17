import { Book } from '../interfaces/project.interface';

/** Normalized title for storage/display when empty. */
export const UNTITLED_BOOK_NAME = 'Untitled';

export function normalizeBookName(name: string | undefined | null): string {
  const trimmed = name?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : UNTITLED_BOOK_NAME;
}

export function normalizeBookCode(code: string | undefined | null): string | undefined {
  const trimmed = code?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Title for storage/display when no code takes priority; never empty. */
export function getBookTitle(book: Pick<Book, 'name'>): string {
  return normalizeBookName(book.name);
}

/**
 * Primary label for lists, filters, chips, and confirms.
 * Prefers code; includes title when it adds information.
 */
export function getBookDisplayName(book: Pick<Book, 'name' | 'code'>): string {
  const code = normalizeBookCode(book.code);
  const title = getBookTitle(book);

  if (code && title !== UNTITLED_BOOK_NAME) {
    return `${code} — ${title}`;
  }
  if (code) {
    return code;
  }
  return title;
}

/** Spine / compact label: code when set (short), otherwise title. */
export function getBookSpineLabel(book: Pick<Book, 'name' | 'code'>): string {
  return normalizeBookCode(book.code) || getBookTitle(book);
}

/** Cover title: code preferred (more important than description/title when set). */
export function getBookCoverTitle(book: Pick<Book, 'name' | 'code'>): string {
  return normalizeBookCode(book.code) || getBookTitle(book);
}

/**
 * Cover subtitle: when code is primary, show title (if not Untitled) or description;
 * otherwise description.
 */
export function getBookSubtitle(
  book: Pick<Book, 'name' | 'code' | 'description'>
): string {
  const code = normalizeBookCode(book.code);
  const title = getBookTitle(book);
  if (code) {
    return title !== UNTITLED_BOOK_NAME ? title : (book.description?.trim() || '');
  }
  return book.description?.trim() || '';
}
