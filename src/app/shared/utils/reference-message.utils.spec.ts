import { formatReferenceList, buildDeleteReferencesMessage } from './reference-message.utils';

describe('Reference Message Utils', () => {
  describe('formatReferenceList', () => {
    it('should format a single item', () => {
      const singleHouse = [{ id: 'h1', name: 'House Stark' }];
      expect(formatReferenceList(singleHouse, 'house', 'houses')).toBe('1 house: House Stark');
    });

    it('should format two items', () => {
      const twoHouses = [{ id: 'h1', name: 'House Stark' }, { id: 'h2', name: 'House Tully' }];
      expect(formatReferenceList(twoHouses, 'house', 'houses')).toBe('2 houses: House Stark, House Tully');
    });

    it('should truncate with +N more when more than maxShow items', () => {
      const fiveHouses = [
        { id: 'h1', name: 'House Stark' },
        { id: 'h2', name: 'House Tully' },
        { id: 'h3', name: 'House Lannister' },
        { id: 'h4', name: 'House Baratheon' },
        { id: 'h5', name: 'House Targaryen' }
      ];
      expect(formatReferenceList(fiveHouses, 'house', 'houses')).toBe('5 houses: House Stark, House Tully, House Lannister +2 more');
    });

    it('should return empty string for empty array', () => {
      const empty: { id: string; name: string }[] = [];
      expect(formatReferenceList(empty, 'house', 'houses')).toBe('');
    });

    it('should respect custom maxShow parameter', () => {
      const fourHouses = [
        { id: 'h1', name: 'Stark' },
        { id: 'h2', name: 'Tully' },
        { id: 'h3', name: 'Lannister' },
        { id: 'h4', name: 'Baratheon' }
      ];
      expect(formatReferenceList(fourHouses, 'house', 'houses', 2)).toBe('4 houses: Stark, Tully +2 more');
    });
  });

  describe('buildDeleteReferencesMessage', () => {
    it('should build complete confirmation message with all reference types', () => {
      const refs = {
        houses: [{ id: 'h1', name: 'House Stark' }],
        casts: [{ id: 'c1', name: 'Main Cast' }, { id: 'c2', name: 'Supporting Cast' }],
        pinboards: [{ id: 'pb1', name: 'Relationships' }],
        plotBoards: []
      };

      const message = buildDeleteReferencesMessage(refs);
      expect(message).toContain('\n\nThis character will be removed from:');
      expect(message).toContain('1 house: House Stark');
      expect(message).toContain('2 casts: Main Cast, Supporting Cast');
      expect(message).toContain('1 pinboard: Relationships');
    });

    it('should return empty string when character has no references', () => {
      const refs = {
        houses: [],
        casts: [],
        pinboards: [],
        plotBoards: []
      };

      expect(buildDeleteReferencesMessage(refs)).toBe('');
    });

    it('should handle all four reference categories together', () => {
      const refs = {
        houses: [{ id: 'h1', name: 'Stark' }],
        casts: [{ id: 'c1', name: 'Main' }],
        pinboards: [{ id: 'pb1', name: 'Board1' }],
        plotBoards: [{ id: 'plot.plotboard.md', name: 'plot' }]
      };

      const message = buildDeleteReferencesMessage(refs);
      expect(message).toContain('1 house: Stark');
      expect(message).toContain('1 cast: Main');
      expect(message).toContain('1 pinboard: Board1');
      expect(message).toContain('1 plot board: plot');
    });

    it('should format multiple plot boards correctly', () => {
      const refs = {
        houses: [],
        casts: [],
        pinboards: [],
        plotBoards: [
          { id: 'arc1.plotboard.md', name: 'arc1' },
          { id: 'arc2.plotboard.md', name: 'arc2' }
        ]
      };

      const message = buildDeleteReferencesMessage(refs);
      expect(message).toContain('2 plot boards: arc1, arc2');
    });

    it('should truncate long lists with +N more', () => {
      const refs = {
        houses: [
          { id: 'h1', name: 'Stark' },
          { id: 'h2', name: 'Tully' },
          { id: 'h3', name: 'Lannister' },
          { id: 'h4', name: 'Baratheon' },
          { id: 'h5', name: 'Targaryen' }
        ],
        casts: [],
        pinboards: [],
        plotBoards: []
      };

      const message = buildDeleteReferencesMessage(refs);
      expect(message).toContain('5 houses: Stark, Tully, Lannister +2 more');
    });
  });
});
