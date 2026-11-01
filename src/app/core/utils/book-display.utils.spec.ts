import {
  bookPageSuffix,
  getBookCoverTitle,
  getBookDisplayName,
  getBookSpineLabel,
  getBookSubtitle,
  getBookTitle,
  normalizeBookCode,
  normalizeBookName,
  UNTITLED_BOOK_NAME,
} from './book-display.utils';

describe('book-display.utils', () => {
  it('normalizes empty name to Untitled', () => {
    expect(normalizeBookName('')).toBe(UNTITLED_BOOK_NAME);
    expect(normalizeBookName('  ')).toBe(UNTITLED_BOOK_NAME);
    expect(normalizeBookName('n23')).toBe('n23');
  });

  it('normalizes empty code to undefined', () => {
    expect(normalizeBookCode('')).toBeUndefined();
    expect(normalizeBookCode('  ')).toBeUndefined();
    expect(normalizeBookCode('n23')).toBe('n23');
  });

  it('formats display name with code preferred', () => {
    expect(getBookDisplayName({ name: 'My Novel', code: 'n23' })).toBe('n23 — My Novel');
    expect(getBookDisplayName({ name: 'Untitled', code: 'n23' })).toBe('n23');
    expect(getBookDisplayName({ name: 'My Novel' })).toBe('My Novel');
    expect(getBookTitle({ name: '' })).toBe('Untitled');
  });

  it('uses code on spine and cover when set', () => {
    const book = { name: 'My Novel', code: 'n23', description: 'A synopsis' };
    expect(getBookSpineLabel(book)).toBe('n23');
    expect(getBookCoverTitle(book)).toBe('n23');
    expect(getBookSubtitle(book)).toBe('My Novel');
  });

  it('falls back to description when no code', () => {
    expect(getBookSubtitle({ name: 'My Novel', description: 'A synopsis' })).toBe('A synopsis');
  });
  describe('bookPageSuffix', () => {
    it('slugs the code, falling back to the id', () => {
      expect(bookPageSuffix({ id: 'the-book', code: 'N26' })).toBe('n26');
      expect(bookPageSuffix({ id: 'the-book', code: '  ' })).toBe('the-book');
      expect(bookPageSuffix({ id: 'the-book' })).toBe('the-book');
      expect(bookPageSuffix({ id: 'the-book', code: '!!!' })).toBe('the-book');
    });

    it('maps codes that differ only in case, dots or accents to the same suffix', () => {
      expect(bookPageSuffix({ id: 'a', code: 'lc1' })).toBe(bookPageSuffix({ id: 'b', code: 'LC1.' }));
      expect(bookPageSuffix({ id: 'a', code: 'Á1' })).toBe(bookPageSuffix({ id: 'b', code: 'A1' }));
    });
  });
});
