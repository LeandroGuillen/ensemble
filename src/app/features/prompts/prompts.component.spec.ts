import { buildPromptTree, matchesPromptSearch } from './prompts.component';
import { PromptFile } from '../../core/interfaces/prompt.interface';

const file = (relativePath: string, prompt = ''): PromptFile => {
  const slash = relativePath.lastIndexOf('/');
  return {
    relativePath,
    filePath: `/vault/prompts/${relativePath}`,
    name: relativePath.slice(slash + 1).replace(/\.md$/, ''),
    folder: slash === -1 ? '' : relativePath.slice(0, slash),
    characters: [],
    locations: [],
    tags: ['pony'],
    extra: {},
    sections: [{ name: '', notes: '', prompt, negative: null, images: [] }],
  };
};

describe('prompts page helpers', () => {
  it('builds a sorted folder tree with totals', () => {
    const tree = buildPromptTree([
      file('scenes/n26/2105.md'),
      file('characters/Reul.md'),
      file('characters/Dessir.md'),
      file('llm.md'),
    ]);
    expect(tree.total).toBe(4);
    expect(tree.files.map((f) => f.name)).toEqual(['llm']);
    expect(tree.folders.map((f) => [f.path, f.total])).toEqual([
      ['characters', 2],
      ['scenes', 1],
    ]);
    expect(tree.folders[0].files.map((f) => f.name)).toEqual(['Dessir', 'Reul']);
    expect(tree.folders[1].folders[0].path).toBe('scenes/n26');
  });

  it('matches every search term against names, tags and prompt text', () => {
    const elf = file('characters/Dessir.md', '1woman, pointy ears, blonde');
    expect(matchesPromptSearch(elf, 'pointy ears')).toBeTrue();
    expect(matchesPromptSearch(elf, 'DESSIR pony')).toBeTrue();
    expect(matchesPromptSearch(elf, 'pointy beard')).toBeFalse();
    expect(matchesPromptSearch(elf, '   ')).toBeTrue();
  });
});
