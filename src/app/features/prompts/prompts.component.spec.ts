import { buildPromptTree, matchesPromptSearch, PromptsComponent } from './prompts.component';
import { PromptEditorComponent } from './components/prompt-editor/prompt-editor.component';
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

/**
 * A link whose character / location was deleted but is still in the prompt
 * file (e.g. the file could not be read during the delete) shows the name the
 * record had, never an anonymous "Missing character".
 */
describe('prompt links to deleted records', () => {
  const deletedNames: Record<string, Record<string, string>> = {
    characters: { 'mara-vell': 'Mara Vell' },
    locations: { 'grey-harbor': 'Grey Harbor' },
  };
  const promptService = {
    deletedName: (field: string, id: string) => deletedNames[field]?.[id] ?? null,
  };
  const ben = { id: 'ben', name: 'Ben' };
  const lighthouse = { id: 'lighthouse', name: 'Lighthouse' };

  it('the editor chips show the deleted record name', () => {
    const editor = Object.create(PromptEditorComponent.prototype) as PromptEditorComponent;
    Object.assign(editor, { promptService, characters: [ben], locations: [lighthouse] });

    expect(editor.characterName('ben')).toBe('Ben');
    expect(editor.characterName('mara-vell')).toBe('Mara Vell (deleted)');
    expect(editor.isMissingCharacter('mara-vell')).toBeTrue();
    expect(editor.locationName('grey-harbor')).toBe('Grey Harbor (deleted)');
    // Nothing stored (never deleted through the app): unchanged fallback.
    expect(editor.characterName('ghost')).toBe('Missing character');
    expect(editor.locationName('nowhere')).toBe('Missing location');
  });

  it('the prompt card lists the deleted record names', () => {
    const page = Object.create(PromptsComponent.prototype) as PromptsComponent;
    Object.assign(page, { promptService, linkTargets: [ben], locations: [lighthouse] });
    const linked = {
      ...file('places/Grey Harbor.md'),
      characters: ['ben', 'mara-vell', 'ghost'],
      locations: ['grey-harbor', 'lighthouse'],
    };

    expect(page.linkNames(linked)).toEqual([
      'Ben',
      'Mara Vell (deleted)',
      'Grey Harbor (deleted)',
      'Lighthouse',
    ]);
  });
});
