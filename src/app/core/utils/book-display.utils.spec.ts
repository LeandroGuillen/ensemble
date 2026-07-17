import {
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
});
