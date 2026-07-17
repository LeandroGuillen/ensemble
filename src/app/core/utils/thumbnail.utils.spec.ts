import {
  parseThumbnailReference,
  resolveThumbnailPath,
  resolveThumbnailForStyle,
  normalizeThumbnailsMap,
} from './thumbnail.utils';

describe('thumbnail.utils', () => {
  describe('parseThumbnailReference', () => {
    it('should extract path from Obsidian wiki-link format', () => {
      expect(parseThumbnailReference('[[img/dessir.png]]')).toBe('img/dessir.png');
      expect(parseThumbnailReference('[[img/reul.jpg]]')).toBe('img/reul.jpg');
    });

    it('should return plain path as-is', () => {
      expect(parseThumbnailReference('img/dessir.png')).toBe('img/dessir.png');
      expect(parseThumbnailReference('img/subfolder/image.jpg')).toBe('img/subfolder/image.jpg');
    });

    it('should handle wiki-link without extension (Obsidian style)', () => {
      expect(parseThumbnailReference('[[img/dessir]]')).toBe('img/dessir');
    });

    it('should handle wiki-link with label', () => {
      expect(parseThumbnailReference('[[img/dessir.png|Dessir]]')).toBe('img/dessir.png');
    });

    it('should return null for empty or invalid input', () => {
      expect(parseThumbnailReference('')).toBeNull();
      expect(parseThumbnailReference('   ')).toBeNull();
      expect(parseThumbnailReference(null as any)).toBeNull();
      expect(parseThumbnailReference(undefined as any)).toBeNull();
    });

    it('should trim whitespace', () => {
      expect(parseThumbnailReference('  img/dessir.png  ')).toBe('img/dessir.png');
      expect(parseThumbnailReference('  [[img/dessir.png]]  ')).toBe('img/dessir.png');
    });
  });

  describe('resolveThumbnailPath', () => {
    it('should join project path with thumbnail path', () => {
      expect(resolveThumbnailPath('/home/user/project', 'img/dessir.png')).toBe(
        '/home/user/project/img/dessir.png'
      );
    });

    it('should handle project path with trailing slash', () => {
      expect(resolveThumbnailPath('/home/user/project/', 'img/dessir.png')).toBe(
        '/home/user/project/img/dessir.png'
      );
    });

    it('should handle nested thumbnail paths', () => {
      expect(resolveThumbnailPath('/project', 'img/subfolder/dessir.png')).toBe(
        '/project/img/subfolder/dessir.png'
      );
    });
  });

  describe('resolveThumbnailForStyle', () => {
    it('should return the style-specific thumbnail', () => {
      expect(
        resolveThumbnailForStyle(
          { anime: '[[img/anime/a.jpg]]', realistic: '[[img/real/a.jpg]]' },
          'anime'
        )
      ).toBe('[[img/anime/a.jpg]]');
    });

    it('should return null when style is missing (no fallback)', () => {
      expect(resolveThumbnailForStyle({ anime: '[[img/a.jpg]]' }, 'realistic')).toBeNull();
      expect(resolveThumbnailForStyle(undefined, 'anime')).toBeNull();
      expect(resolveThumbnailForStyle({}, 'anime')).toBeNull();
    });

    it('should return null for blank values', () => {
      expect(resolveThumbnailForStyle({ anime: '   ' }, 'anime')).toBeNull();
    });
  });

  describe('normalizeThumbnailsMap', () => {
    it('should keep only non-empty string entries', () => {
      expect(
        normalizeThumbnailsMap({
          anime: '[[img/a.jpg]]',
          empty: '',
          blank: '  ',
          bad: 1 as any,
        })
      ).toEqual({ anime: '[[img/a.jpg]]' });
    });

    it('should return undefined for empty maps', () => {
      expect(normalizeThumbnailsMap({})).toBeUndefined();
      expect(normalizeThumbnailsMap(null)).toBeUndefined();
    });
  });
});
