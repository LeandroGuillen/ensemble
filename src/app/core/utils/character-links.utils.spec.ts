import { Character } from '../interfaces/character.interface';
import { renderCharacterMarkdown, resolveCharacterLink } from './character-links.utils';

const characterMarkdownToHtml = (content: string, characters: Character[]) => renderCharacterMarkdown(content, characters).html;

const harbor = { id: 'harbor-id', name: 'Grey Harbor', relativePath: 'grey-harbor/grey-harbor.md' } as Character;
const woods = { id: 'woods-id', name: 'Woods', relativePath: 'north/_woods.md' } as Character;

describe('character links', () => {
  it('resolves display names and file paths with optional extensions and folder prefixes', () => {
    for (const target of ['Grey Harbor', 'grey harbor', 'grey-harbor', 'grey-harbor.md', 'grey-harbor/grey-harbor.md', 'characters/grey-harbor/grey-harbor.md']) {
      expect(resolveCharacterLink(target, [harbor])).toBe(harbor);
    }
    expect(resolveCharacterLink('places/north/_woods.md', [woods], 'places')).toBe(woods);
    expect(resolveCharacterLink('_woods', [woods])).toBe(woods);
  });

  it('does not guess when duplicate names or filenames are ambiguous', () => {
    const other = { ...woods, id: 'other', relativePath: 'south/_woods.md' };
    expect(resolveCharacterLink('Woods', [woods, other])).toBeUndefined();
    expect(resolveCharacterLink('_woods', [woods, other])).toBeUndefined();
    expect(resolveCharacterLink('north/_woods', [woods, other])).toBe(woods);
    expect(resolveCharacterLink('Missing', [woods])).toBeUndefined();
  });

  it('renders aliases and marks missing links without changing the Markdown source', () => {
    const content = 'Visit [[Grey Harbor|the port]] and [[Missing]].';
    const html = characterMarkdownToHtml(content, [harbor]);
    expect(html).toContain('href="#/character/harbor-id"');
    expect(html).toContain('>the port</a>');
    expect(html).toContain('class="unresolved-character-link"');
    expect(content).toBe('Visit [[Grey Harbor|the port]] and [[Missing]].');
  });

  it('opens missing links in New Character using the target name rather than the alias', () => {
    const preview = renderCharacterMarkdown('[[Hidden Cove|the cove]] and [[Hidden Cove]]', []);
    expect(preview.html).toContain('href="#/character?name=Hidden%20Cove&amp;fromLink=1"');
    expect(preview.html).toContain('>the cove</a>');
    expect(preview.missingLinks).toEqual(['Hidden Cove']);
  });

  it('keeps ambiguous and unsupported heading links out of the creation flow', () => {
    const other = { ...woods, id: 'other', relativePath: 'south/_woods.md' };
    const preview = renderCharacterMarkdown('[[Woods]] [[Woods#History]]', [woods, other]);
    expect(preview.html).not.toContain('#/character?');
    expect(preview.missingLinks).toEqual([]);
  });

  it('encodes punctuation in missing names without adding query parameters', () => {
    const preview = renderCharacterMarkdown('[[Cove & Bay?fromLink=0|the coast]]', []);
    expect(preview.html).toContain('name=Cove%20%26%20Bay%3FfromLink%3D0&amp;fromLink=1');
    expect(preview.missingLinks).toEqual(['Cove & Bay?fromLink=0']);
  });

  it('leaves code, escaped links, embeds, and existing Markdown link labels alone', () => {
    const html = characterMarkdownToHtml('`[[Grey Harbor]]`\n\n```\n[[Grey Harbor]]\n```\n\n![[Grey Harbor]] \\[[Grey Harbor]] [ [[Grey Harbor]] ](https://example.com)', [harbor]);
    expect(html).not.toContain('#/character/');
  });

  it('escapes link labels and attributes instead of inserting user HTML', () => {
    const malicious = { ...harbor, name: '<img src=x onerror="alert(1)">' };
    const html = characterMarkdownToHtml('[[<img src=x onerror="alert(1)">|<script>alert(1)</script>]]', [malicious]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('character links to other entity types', () => {
  const collections = [
    { targets: [{ id: 'house-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' }], folder: 'houses', route: 'house', singular: 'House' },
    { targets: [{ id: 'location-id', name: 'Harbor', relativePath: '_harbor.md' }], folder: 'locations', route: 'location', singular: 'Location' },
  ];

  it('resolves the House path from the reported issue with or without an extension', () => {
    for (const target of ['houses/bulanco/bulanco', 'houses/bulanco/bulanco.md']) {
      const preview = renderCharacterMarkdown(`[[${target}|the family]]`, [], 'characters', collections);
      expect(preview.html).toContain('href="#/house/house-id"');
      expect(preview.html).toContain('>the family</a>');
      expect(preview.missingLinks).toEqual([]);
    }
  });

  it('resolves location paths and unique names across all types', () => {
    const preview = renderCharacterMarkdown('[[locations/_harbor.md]] [[Harbor]] [[Bulanco]]', [], 'characters', collections);
    expect(preview.html.match(/href="#\/location\/location-id"/g)?.length).toBe(2);
    expect(preview.html).toContain('href="#/house/house-id"');
    expect(preview.missingLinks).toEqual([]);
  });

  it('does not guess when names collide across types, and uses explicit folders to disambiguate', () => {
    const character = { id: 'character-id', name: 'Bulanco', relativePath: 'bulanco/bulanco.md' } as Character;
    const preview = renderCharacterMarkdown('[[Bulanco]] [[houses/bulanco/bulanco]] [[characters/bulanco/bulanco]]', [character], 'characters', collections);
    expect(preview.html).toContain('<span');
    expect(preview.html).toContain('href="#/house/house-id"');
    expect(preview.html).toContain('href="#/character/character-id"');
    expect(preview.missingLinks).toEqual([]);
  });

  it('sends missing typed paths to the correct creation page using the filename', () => {
    const preview = renderCharacterMarkdown('[[houses/new-house/new-house.md|family]] [[locations/_cove.md]]', [], 'characters', collections);
    expect(preview.html).toContain('href="#/house?name=new-house&amp;fromLink=1"');
    expect(preview.html).toContain('href="#/location?name=_cove&amp;fromLink=1"');
    expect(preview.html).not.toContain('#/character?');
  });

  it('uses configured folders and normalizes Windows paths', () => {
    const custom = [{ ...collections[1], folder: 'world/places' }];
    const preview = renderCharacterMarkdown('[[world\\places\\_harbor.md]]', [], 'people', custom);
    expect(preview.html).toContain('href="#/location/location-id"');
    expect(preview.missingLinks).toEqual([]);
  });
});
