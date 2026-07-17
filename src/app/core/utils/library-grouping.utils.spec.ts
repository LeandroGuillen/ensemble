import {
  buildLibraryGrouping,
  booksInPlacement,
  placementKey,
} from './library-grouping.utils';
import { Book, Saga, Series } from '../interfaces/project.interface';

describe('library-grouping.utils', () => {
  const series: Series[] = [
    { id: 'dbs', name: 'Dragon Ball Super', color: '#e74c3c' },
    { id: 'hp', name: 'Harry Potter', color: '#3498db' },
  ];
  const sagas: Saga[] = [
    { id: 'zamasu', name: 'Zamasu', seriesId: 'dbs' },
    { id: 'res-f', name: 'Resurrection F', seriesId: 'dbs' },
  ];
  const books: Book[] = [
    { id: 'a', name: 'A', color: '#111111', seriesId: 'dbs', sagaId: 'zamasu' },
    { id: 'b', name: 'B', color: '#222222', seriesId: 'dbs', sagaId: 'res-f' },
    { id: 'c', name: 'C', color: '#333333', seriesId: 'dbs' },
    { id: 'd', name: 'D', color: '#444444', seriesId: 'hp' },
    { id: 'e', name: 'E', color: '#555555' },
  ];

  it('partitions books into series, sagas, loose, and ungrouped', () => {
    const grouping = buildLibraryGrouping(books, series, sagas);

    expect(grouping.seriesGroups.length).toBe(2);
    expect(grouping.seriesGroups[0].sagas.map((s) => s.saga!.id)).toEqual([
      'zamasu',
      'res-f',
    ]);
    expect(grouping.seriesGroups[0].sagas[0].books.map((b) => b.id)).toEqual(['a']);
    expect(grouping.seriesGroups[0].looseBooks.map((b) => b.id)).toEqual(['c']);
    expect(grouping.seriesGroups[0].bookCount).toBe(3);
    expect(grouping.seriesGroups[1].sagas.length).toBe(0);
    expect(grouping.seriesGroups[1].looseBooks.map((b) => b.id)).toEqual(['d']);
    expect(grouping.ungrouped.map((b) => b.id)).toEqual(['e']);
  });

  it('placementKey and booksInPlacement identify shelves', () => {
    expect(placementKey({ sagaId: 'zamasu', seriesId: 'dbs' })).toBe('saga:zamasu');
    expect(placementKey({ seriesId: 'dbs' })).toBe('series:dbs');
    expect(placementKey({})).toBe('ungrouped');

    expect(booksInPlacement(books, { sagaId: 'zamasu', seriesId: 'dbs' }).map((b) => b.id)).toEqual([
      'a',
    ]);
    expect(booksInPlacement(books, { seriesId: 'dbs' }).map((b) => b.id)).toEqual(['c']);
    expect(booksInPlacement(books, {}).map((b) => b.id)).toEqual(['e']);
  });
});
