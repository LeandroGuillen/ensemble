import { Location } from '../interfaces/location.interface';
import { locationMarkdownToHtml, renderLocationMarkdown, resolveLocationLink } from './location-links.utils';

const harbor = { id: 'harbor-id', name: 'Grey Harbor', relativePath: '_grey-harbor.md' } as Location;
const woods = { id: 'woods-id', name: 'Woods', relativePath: 'north/_woods.md' } as Location;

describe('location links', () => {
  it('resolves display names and file paths with optional extensions and folder prefixes', () => {
    for (const target of ['Grey Harbor', 'grey harbor', '_grey-harbor', '_grey-harbor.md', 'locations/_grey-harbor.md']) {
      expect(resolveLocationLink(target, [harbor])).toBe(harbor);
    }
    expect(resolveLocationLink('places/north/_woods.md', [woods], 'places')).toBe(woods);
    expect(resolveLocationLink('_woods', [woods])).toBe(woods);
  });

  it('does not guess when duplicate names or filenames are ambiguous', () => {
    const other = { ...woods, id: 'other', relativePath: 'south/_woods.md' };
    expect(resolveLocationLink('Woods', [woods, other])).toBeUndefined();
    expect(resolveLocationLink('_woods', [woods, other])).toBeUndefined();
    expect(resolveLocationLink('north/_woods', [woods, other])).toBe(woods);
    expect(resolveLocationLink('Missing', [woods])).toBeUndefined();
  });

  it('renders aliases and marks missing links without changing the Markdown source', () => {
    const content = 'Visit [[Grey Harbor|the port]] and [[Missing]].';
    const html = locationMarkdownToHtml(content, [harbor]);
    expect(html).toContain('href="#/location/harbor-id"');
    expect(html).toContain('>the port</a>');
    expect(html).toContain('class="unresolved-location-link"');
    expect(content).toBe('Visit [[Grey Harbor|the port]] and [[Missing]].');
  });

  it('opens missing links in New Location using the target name rather than the alias', () => {
    const preview = renderLocationMarkdown('[[Hidden Cove|the cove]] and [[Hidden Cove]]', []);
    expect(preview.html).toContain('href="#/location?name=Hidden%20Cove&amp;fromLink=1"');
    expect(preview.html).toContain('>the cove</a>');
    expect(preview.missingLinks).toEqual(['Hidden Cove']);
  });

  it('keeps ambiguous and unsupported heading links out of the creation flow', () => {
    const other = { ...woods, id: 'other', relativePath: 'south/_woods.md' };
    const preview = renderLocationMarkdown('[[Woods]] [[Woods#History]]', [woods, other]);
    expect(preview.html).not.toContain('#/location?');
    expect(preview.missingLinks).toEqual([]);
  });

  it('encodes punctuation in missing names without adding query parameters', () => {
    const preview = renderLocationMarkdown('[[Cove & Bay?fromLink=0|the coast]]', []);
    expect(preview.html).toContain('name=Cove%20%26%20Bay%3FfromLink%3D0&amp;fromLink=1');
    expect(preview.missingLinks).toEqual(['Cove & Bay?fromLink=0']);
  });

  it('leaves code, escaped links, embeds, and existing Markdown link labels alone', () => {
    const html = locationMarkdownToHtml('`[[Grey Harbor]]`\n\n```\n[[Grey Harbor]]\n```\n\n![[Grey Harbor]] \\[[Grey Harbor]] [ [[Grey Harbor]] ](https://example.com)', [harbor]);
    expect(html).not.toContain('#/location/');
  });

  it('escapes link labels and attributes instead of inserting user HTML', () => {
    const malicious = { ...harbor, name: '<img src=x onerror="alert(1)">' };
    const html = locationMarkdownToHtml('[[<img src=x onerror="alert(1)">|<script>alert(1)</script>]]', [malicious]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;script&gt;');
  });
});
