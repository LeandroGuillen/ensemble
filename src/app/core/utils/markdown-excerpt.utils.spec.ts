import { markdownExcerpt, wikiLinksAsText } from './markdown-excerpt.utils';

describe('markdownExcerpt', () => {
  it('shows wiki links as their label or target', () => {
    expect(markdownExcerpt('Cael teaches at [[Vellhaven Lighthouse]] with [[mara-vell|Mara]].'))
      .toBe('Cael teaches at Vellhaven Lighthouse with Mara.');
  });

  it('drops heading, emphasis, list and link syntax', () => {
    expect(markdownExcerpt('# Title\n\n- **Bold** and _soft_ [link](http://x.y)\n> quoted'))
      .toBe('Title Bold and soft link quoted');
  });

  it('removes embeds', () => {
    expect(markdownExcerpt('Before ![[img/a.png]] after ![alt](b.png)')).toBe('Before after');
  });

  it('cuts on a word boundary with an ellipsis', () => {
    const result = markdownExcerpt('one two three four five six seven', 20);
    expect(result).toBe('one two three four…');
  });

  it('returns empty text for empty bodies', () => {
    expect(markdownExcerpt('')).toBe('');
    expect(markdownExcerpt(undefined)).toBe('');
  });
});

describe('wikiLinksAsText', () => {
  it('replaces wiki links with labels and keeps line breaks', () => {
    expect(wikiLinksAsText('[[Mara Vell]] finds\n[[lc/_harbor|the harbor]].')).toBe('Mara Vell finds\nthe harbor.');
  });

  it('leaves embeds alone', () => {
    expect(wikiLinksAsText('![[img.png]]')).toBe('![[img.png]]');
  });
});
