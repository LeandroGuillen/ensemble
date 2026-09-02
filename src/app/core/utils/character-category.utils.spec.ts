import {
  isEffectiveCategoryEnabled,
  normalizeBookCategories,
  resolveEffectiveCategory,
} from './character-category.utils';

describe('character-category.utils', () => {
  describe('resolveEffectiveCategory', () => {
    const character = {
      category: 'antagonist',
      bookCategories: {
        'book-2': 'main-character',
      },
    };

    it('returns default category when no book is selected', () => {
      expect(resolveEffectiveCategory(character)).toBe('antagonist');
      expect(resolveEffectiveCategory(character, '')).toBe('antagonist');
      expect(resolveEffectiveCategory(character, null)).toBe('antagonist');
    });

    it('returns override when selected book has one', () => {
      expect(resolveEffectiveCategory(character, 'book-2')).toBe('main-character');
    });

    it('falls back to default when selected book has no override', () => {
      expect(resolveEffectiveCategory(character, 'book-1')).toBe('antagonist');
    });

    it('falls back when bookCategories is missing', () => {
      expect(resolveEffectiveCategory({ category: 'supporting' }, 'book-1')).toBe(
        'supporting'
      );
    });
  });

  describe('normalizeBookCategories', () => {
    it('returns undefined for empty or invalid input', () => {
      expect(normalizeBookCategories(undefined)).toBeUndefined();
      expect(normalizeBookCategories(null)).toBeUndefined();
      expect(normalizeBookCategories([])).toBeUndefined();
      expect(normalizeBookCategories({})).toBeUndefined();
    });

    it('keeps valid string entries', () => {
      expect(
        normalizeBookCategories({
          'book-1': 'main-character',
          'book-2': '  supporting  ',
          'book-3': '',
          'book-4': 42,
        })
      ).toEqual({
        'book-1': 'main-character',
        'book-2': 'supporting',
      });
    });

    it('prunes entries for books not in the assigned list', () => {
      expect(
        normalizeBookCategories(
          {
            'book-1': 'main-character',
            'book-2': 'supporting',
          },
          ['book-1']
        )
      ).toEqual({ 'book-1': 'main-character' });
    });
  });

  describe('isEffectiveCategoryEnabled', () => {
    const character = {
      category: 'supporting',
      bookCategories: { 'book-one': 'lead' },
    };
    const categories = ['lead', 'supporting'];

    it('shows characters when all categories are enabled', () => {
      expect(
        isEffectiveCategoryEnabled(character, '', categories, categories)
      ).toBeTrue();
    });

    it('hides characters whose category is disabled', () => {
      expect(isEffectiveCategoryEnabled(character, '', categories, ['lead'])).toBeFalse();
    });

    it('uses the book-specific category when a book is selected', () => {
      expect(
        isEffectiveCategoryEnabled(character, 'book-one', categories, ['supporting'])
      ).toBeFalse();
      expect(
        isEffectiveCategoryEnabled(character, 'book-one', categories, ['lead'])
      ).toBeTrue();
    });

    it('keeps unknown categories visible', () => {
      expect(isEffectiveCategoryEnabled({ category: 'legacy' }, '', categories, [])).toBeTrue();
    });
  });
});
