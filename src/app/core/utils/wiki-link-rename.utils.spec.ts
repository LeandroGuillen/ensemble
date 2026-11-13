import { buildWikiLinkTargets } from './wiki-links.utils';
import { rewriteRenamedLinks } from './wiki-link-rename.utils';

describe('rename wiki links', () => {
  const targets = buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets: [
    { id: 'dess', name: 'Dess', relativePath: 'dess/dess.md', aliases: ['Witch'] },
    { id: 'other', name: 'Other', relativePath: 'other/other.md' },
  ] }]);
  it('rewrites name and path links while preserving labels and heading fragments', () => {
    const result = rewriteRenamedLinks('[[Dess]] [[characters/dess/dess.md#Past|the witch]] [[Other]]', targets, targets, 'dess', 'character', 'Dessir Galsea');
    expect(result.count).toBe(2);
    expect(result.content).toBe('[[Dessir Galsea]] [[Dessir Galsea#Past|the witch]] [[Other]]');
  });
  it('rewrites alias links whose alias no longer reaches the record after the rename', () => {
    const after = buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets: [
      { id: 'dess', name: 'Dessir Galsea', relativePath: 'dessir-galsea/dessir-galsea.md' },
    ] }]);
    expect(rewriteRenamedLinks('[[Witch|old name]]', targets, after, 'dess', 'character', 'Dessir Galsea'))
      .toEqual({ content: '[[Dessir Galsea|old name]]', count: 1 });
  });
  it('leaves protected markdown and other record types unchanged', () => {
    const source = '`[[Dess]]` ![[Dess]] \\[[Dess]]\n```\n[[Dess]]\n```\n[[Other]]';
    expect(rewriteRenamedLinks(source, targets, targets, 'dess', 'character', 'New').content).toBe(source);
    expect(rewriteRenamedLinks('[[Dess]]', targets, targets, 'dess', 'house', 'New').count).toBe(0);
  });
  it('does not rewrite a canonical name belonging to another record', () => {
    const canonical = buildWikiLinkTargets([{ folder: 'houses', route: 'house', singular: 'House', targets: [
      { id: 'one', name: 'Winter', relativePath: 'one.md', aliases: ['Old'] },
      { id: 'two', name: 'Old', relativePath: 'two.md' },
    ] }]);
    expect(rewriteRenamedLinks('[[Old]]', canonical, canonical, 'one', 'house', 'New').count).toBe(0);
  });
});

describe('rename rewrites with colliding aliases', () => {
  it('rewrites canonical links without touching links owned by another name or path', () => {
    const links = buildWikiLinkTargets([{ folder: 'characters', route: 'character', singular: 'Character', targets: [
      { id: 'a', name: 'Ilse', relativePath: 'ilse/ilse.md' },
      { id: 'b', name: 'Other', relativePath: 'other/other.md', aliases: ['Ilse', 'ilse/ilse'] },
    ] }]);
    const source = '[[Ilse|friend]] [[ilse/ilse#History]]';
    expect(rewriteRenamedLinks(source, links, links, 'a', 'character', 'New Ilse')).toEqual({ content: '[[New Ilse|friend]] [[New Ilse#History]]', count: 2 });
    expect(rewriteRenamedLinks(source, links, links, 'b', 'character', 'New Other')).toEqual({ content: source, count: 0 });
  });
});

describe('rename leaves alias links alone', () => {
  const cases = [
    { folder: 'characters', route: 'character', singular: 'Character', id: 'mara', oldName: 'Mara Vell', newName: 'Mara Vell-Reed', oldPath: 'mara-vell/mara-vell.md', newPath: 'mara-vell-reed/mara-vell-reed.md', alias: 'The Lamplighter' },
    { folder: 'locations', route: 'location', singular: 'Location', id: 'harbor', oldName: 'Grey Harbor', newName: 'Grey Haven', oldPath: '_grey-harbor.md', newPath: '_grey-haven.md', alias: 'The Docks' },
    { folder: 'houses', route: 'house', singular: 'House', id: 'vell', oldName: 'House Vell', newName: 'House Vell-Reed', oldPath: 'house-vell/house-vell.md', newPath: 'house-vell-reed/house-vell-reed.md', alias: 'The Lamp House' },
  ];
  for (const c of cases) {
    it(`keeps ${c.route} alias links and rewrites name links`, () => {
      const build = (name: string, relativePath: string) => buildWikiLinkTargets([{ folder: c.folder, route: c.route, singular: c.singular, targets: [
        { id: c.id, name, relativePath, aliases: [c.alias] },
        { id: 'other', name: 'Other', relativePath: 'other.md' },
      ] }]);
      const before = build(c.oldName, c.oldPath);
      const after = build(c.newName, c.newPath);
      const source = `They call her [[${c.alias}]], or [[${c.alias}|her]]; see [[${c.oldName}]] and [[${c.alias}#Past]].`;
      expect(rewriteRenamedLinks(source, before, after, c.id, c.route, c.newName)).toEqual({
        content: `They call her [[${c.alias}]], or [[${c.alias}|her]]; see [[${c.newName}]] and [[${c.alias}#Past]].`,
        count: 1,
      });
    });
  }
});
