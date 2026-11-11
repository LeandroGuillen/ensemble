import { buildWikiLinkTargets } from './wiki-links.utils';
import { rewriteRenamedLinks } from './wiki-link-rename.utils';

describe('rename wiki links', () => {
  const targets = buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets: [
    { id: 'dess', name: 'Dess', relativePath: 'dess/dess.md', aliases: ['Witch'] },
    { id: 'other', name: 'Other', relativePath: 'other/other.md' },
  ] }]);
  it('rewrites name, path and alias links while preserving labels and heading fragments', () => {
    const result = rewriteRenamedLinks('[[Dess]] [[characters/dess/dess.md#Past|the witch]] [[Witch|old name]] [[Other]]', targets, 'dess', 'character', 'Dessir Galsea');
    expect(result.count).toBe(3);
    expect(result.content).toBe('[[Dessir Galsea]] [[Dessir Galsea#Past|the witch]] [[Dessir Galsea|old name]] [[Other]]');
  });
  it('leaves protected markdown and other record types unchanged', () => {
    const source = '`[[Dess]]` ![[Dess]] \\[[Dess]]\n```\n[[Dess]]\n```\n[[Other]]';
    expect(rewriteRenamedLinks(source, targets, 'dess', 'character', 'New').content).toBe(source);
    expect(rewriteRenamedLinks('[[Dess]]', targets, 'dess', 'house', 'New').count).toBe(0);
  });
  it('does not rewrite a canonical name belonging to another record', () => {
    const canonical = buildWikiLinkTargets([{ folder: 'houses', route: 'house', singular: 'House', targets: [
      { id: 'one', name: 'Winter', relativePath: 'one.md', aliases: ['Old'] },
      { id: 'two', name: 'Old', relativePath: 'two.md' },
    ] }]);
    expect(rewriteRenamedLinks('[[Old]]', canonical, 'one', 'house', 'New').count).toBe(0);
  });
});

describe('rename rewrites with colliding aliases', () => {
  it('rewrites canonical links without touching links owned by another name or path', () => {
    const links = buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets: [
      { id: 'a', name: 'Ilse', relativePath: 'ilse/ilse.md' },
      { id: 'b', name: 'Other', relativePath: 'other/other.md', aliases: ['Ilse', 'ilse/ilse'] },
    ] }]);
    const source = '[[Ilse|friend]] [[ilse/ilse#History]]';
    expect(rewriteRenamedLinks(source, links, 'a', 'character', 'New Ilse')).toEqual({ content: '[[New Ilse|friend]] [[New Ilse#History]]', count: 2 });
    expect(rewriteRenamedLinks(source, links, 'b', 'character', 'New Other')).toEqual({ content: source, count: 0 });
  });
});
