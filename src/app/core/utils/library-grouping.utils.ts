import { Book, Saga, Series } from '../interfaces/project.interface';

/** A shelf of books within a series (a saga, or loose books with no saga). */
export interface LibraryShelf {
  kind: 'saga' | 'loose';
  saga?: Saga;
  books: Book[];
}

/** A series case with nested saga shelves and optional loose books. */
export interface LibrarySeriesGroup {
  series: Series;
  sagas: LibraryShelf[];
  /** Books in this series with no saga; empty when there are no such books. */
  looseBooks: Book[];
  /** Total books in this series (sagas + loose). */
  bookCount: number;
}

export interface LibraryGrouping {
  seriesGroups: LibrarySeriesGroup[];
  ungrouped: Book[];
}

/**
 * Partitions books into series → sagas → loose-in-series → ungrouped,
 * preserving relative order from `series[]`, `sagas[]`, and `books[]`.
 */
export function buildLibraryGrouping(
  books: Book[],
  series: Series[] = [],
  sagas: Saga[] = []
): LibraryGrouping {
  const seriesGroups: LibrarySeriesGroup[] = series.map((s) => {
    const seriesSagas = sagas.filter((saga) => saga.seriesId === s.id);
    const sagaShelves: LibraryShelf[] = seriesSagas.map((saga) => ({
      kind: 'saga' as const,
      saga,
      books: books.filter((b) => b.sagaId === saga.id && b.seriesId === s.id),
    }));

    const looseBooks = books.filter(
      (b) => b.seriesId === s.id && !b.sagaId
    );

    const bookCount =
      sagaShelves.reduce((sum, shelf) => sum + shelf.books.length, 0) +
      looseBooks.length;

    return {
      series: s,
      sagas: sagaShelves,
      looseBooks,
      bookCount,
    };
  });

  const knownSeriesIds = new Set(series.map((s) => s.id));
  const ungrouped = books.filter(
    (b) => !b.seriesId || !knownSeriesIds.has(b.seriesId)
  );

  return { seriesGroups, ungrouped };
}

/** Target membership for placing a book on a shelf. */
export interface BookPlacement {
  seriesId?: string;
  sagaId?: string;
}

export function placementKey(placement: BookPlacement): string {
  if (placement.sagaId) {
    return `saga:${placement.sagaId}`;
  }
  if (placement.seriesId) {
    return `series:${placement.seriesId}`;
  }
  return 'ungrouped';
}

export function bookPlacement(book: Book): BookPlacement {
  return {
    seriesId: book.seriesId,
    sagaId: book.sagaId,
  };
}

/**
 * Returns books that currently belong to the given placement,
 * in `books[]` order.
 */
export function booksInPlacement(
  books: Book[],
  placement: BookPlacement
): Book[] {
  if (placement.sagaId) {
    return books.filter(
      (b) =>
        b.sagaId === placement.sagaId &&
        (!placement.seriesId || b.seriesId === placement.seriesId)
    );
  }
  if (placement.seriesId) {
    return books.filter(
      (b) => b.seriesId === placement.seriesId && !b.sagaId
    );
  }
  return books.filter((b) => !b.seriesId);
}
