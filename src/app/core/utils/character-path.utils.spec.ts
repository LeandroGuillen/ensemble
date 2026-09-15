import {
  CHARACTER_DRAFTS_FOLDER,
  characterFolderRelativePath,
  parseCharacterMainFileLocation,
} from './character-path.utils';

describe('character path utilities', () => {
  it('recognizes active and draft main files', () => {
    expect(parseCharacterMainFileLocation('roger-rabbit/roger-rabbit.md')).toEqual({
      draft: false,
      folderName: 'roger-rabbit',
    });
    expect(
      parseCharacterMainFileLocation(`${CHARACTER_DRAFTS_FOLDER}/unnamed-abc/unnamed-abc.md`)
    ).toEqual({ draft: true, folderName: 'unnamed-abc' });
  });

  it('ignores book pages, arbitrary markdown, and nested non-character files', () => {
    expect(parseCharacterMainFileLocation('roger-rabbit/roger-rabbit.n26.md')).toBeNull();
    expect(parseCharacterMainFileLocation('roger-rabbit/notes.md')).toBeNull();
    expect(parseCharacterMainFileLocation('casts/heroes/heroes.md')).toBeNull();
    expect(parseCharacterMainFileLocation('loose.md')).toBeNull();
  });

  it('returns the directory relative to the configured characters folder', () => {
    expect(characterFolderRelativePath('roger-rabbit/roger-rabbit.md')).toBe('roger-rabbit');
    expect(characterFolderRelativePath('@drafts/unnamed-a/unnamed-a.md')).toBe(
      '@drafts/unnamed-a'
    );
  });
});
