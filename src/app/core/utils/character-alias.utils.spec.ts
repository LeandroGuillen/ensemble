import {
  aliasMatchesSearch,
  aliasesMatchSearch,
  firstMatchingAlias,
  normalizeAliases,
} from './character-alias.utils';

describe('character-alias.utils', () => {
  describe('normalizeAliases', () => {
    it('returns empty array for missing or invalid input', () => {
      expect(normalizeAliases(undefined)).toEqual([]);
      expect(normalizeAliases(null)).toEqual([]);
      expect(normalizeAliases(42)).toEqual([]);
      expect(normalizeAliases([])).toEqual([]);
    });

    it('coerces a single string into a one-element array', () => {
      expect(normalizeAliases('The Butcher')).toEqual(['The Butcher']);
      expect(normalizeAliases('   ')).toEqual([]);
    });

    it('trims and drops empty entries from a list', () => {
      expect(normalizeAliases([' Ada ', '', '  ', 'Bo'])).toEqual(['Ada', 'Bo']);
    });

    it('ignores non-string entries', () => {
      expect(normalizeAliases(['Ada', 7, null, 'Bo'])).toEqual(['Ada', 'Bo']);
    });

    it('dedupes case-insensitively, keeping first occurrence', () => {
      expect(normalizeAliases(['Ada', 'ada', 'ADA', 'Bo'])).toEqual(['Ada', 'Bo']);
    });
  });

  describe('aliasMatchesSearch', () => {
    it('matches case-insensitively by substring', () => {
      expect(aliasMatchesSearch('The Butcher', 'butch')).toBe(true);
      expect(aliasMatchesSearch('Ada', 'ADA')).toBe(true);
      expect(aliasMatchesSearch('Ada', 'xyz')).toBe(false);
    });

    it('does not match an empty search term', () => {
      expect(aliasMatchesSearch('Ada', '')).toBe(false);
    });
  });

  describe('aliasesMatchSearch', () => {
    it('is false for missing aliases or empty search term', () => {
      expect(aliasesMatchSearch(undefined, 'ada')).toBe(false);
      expect(aliasesMatchSearch([], 'ada')).toBe(false);
      expect(aliasesMatchSearch(['Ada'], '')).toBe(false);
    });

    it('is true when any alias matches', () => {
      expect(aliasesMatchSearch(['Bo', 'The Butcher'], 'butch')).toBe(true);
      expect(aliasesMatchSearch(['Bo', 'Ada'], 'butch')).toBe(false);
    });
  });

  describe('firstMatchingAlias', () => {
    it('returns the first alias that contains the search term', () => {
      expect(firstMatchingAlias(['Bo', 'The Butcher'], 'butch')).toBe('The Butcher');
      expect(firstMatchingAlias(['Bo', 'Ada'], 'butch')).toBeUndefined();
      expect(firstMatchingAlias(undefined, 'ada')).toBeUndefined();
    });
  });
});
