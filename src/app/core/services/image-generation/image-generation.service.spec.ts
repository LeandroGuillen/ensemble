import {
  buildGeneratedImagePath,
  normalizeRelativeDirectory,
} from './image-generation.service';

describe('ImageGenerationService path helpers', () => {
  it('builds a project-relative generated portrait path', () => {
    const path = buildGeneratedImagePath(
      'img',
      'Dessir Galsea',
      'PNG',
      new Date(2026, 6, 13, 15, 51, 0)
    );
    expect(path).toBe('img/@new/dessir-galsea-20260713-155100.png');
  });

  it('normalizes custom image folders and unsafe extensions', () => {
    const path = buildGeneratedImagePath(
      '/art/portraits/',
      'A / B',
      '.webp',
      new Date(2026, 0, 2, 3, 4, 5)
    );
    expect(path).toBe('art/portraits/@new/a-b-20260102-030405.webp');
  });

  it('transliterates accented characters in generated portrait filenames', () => {
    const path = buildGeneratedImagePath(
      'img',
      'José García',
      'png',
      new Date(2026, 6, 13, 15, 51, 0)
    );
    expect(path).toBe('img/@new/jose-garcia-20260713-155100.png');
  });

  it('writes into the provided thumbnail directory when one is given', () => {
    const path = buildGeneratedImagePath(
      'img',
      'Dessir Galsea',
      'png',
      new Date(2026, 6, 13, 15, 51, 0),
      'img/_pjs/zzz_all_cast/'
    );
    expect(path).toBe('img/_pjs/zzz_all_cast/dessir-galsea-20260713-155100.png');
  });

  it('normalizes image-browser directories without allowing traversal', () => {
    expect(normalizeRelativeDirectory('/characters\\main/')).toBe('characters/main');
    expect(() => normalizeRelativeDirectory('../outside')).toThrowError(
      'Invalid image directory'
    );
  });
});
