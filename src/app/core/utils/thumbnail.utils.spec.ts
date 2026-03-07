import { parseThumbnailReference, resolveThumbnailPath } from './thumbnail.utils';

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
});
