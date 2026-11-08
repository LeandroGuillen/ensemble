import { markdownExcerpt, wikiLinksAsText } from './markdown-excerpt.utils';

describe('markdownExcerpt', () => {
  it('shows wiki links as their label or target', () => {
    expect(markdownExcerpt('Cael teaches at [[Vellhaven Lighthouse]] with [[mara-vell|Mara]].'))
      .toBe('Cael teaches at Vellhaven Lighthouse with Mara.');
  });

  it('keeps a # that is part of a wiki link name', () => {
    expect(markdownExcerpt('Meet [[Unit #7]] today')).toBe('Meet Unit #7 today');
    expect(markdownExcerpt('Meet [[Unit #7#Origins]] today')).toBe('Meet Unit #7 today');
  });

  it('still shows heading links as their record name', () => {
    expect(markdownExcerpt('See [[Mara#Backstory]] and [[Mara#^b1]].')).toBe('See Mara and Mara.');
  });

  it('leaves escaped wiki links as written', () => {
    expect(markdownExcerpt('not a link \\[[Mara]] here')).toBe('not a link \\[[Mara]] here');
    expect(markdownExcerpt('Met [[Unit #7]] at the docks; not \\[[Literal]].'))
      .toBe('Met Unit #7 at the docks; not \\[[Literal]].');
  });

  it('still rewrites a link after an escaped backslash', () => {
    expect(markdownExcerpt('path \\\\[[Mara]]')).toBe('path \\\\Mara');
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

  it('keeps a # that is part of the name and drops heading fragments', () => {
    expect(wikiLinksAsText('[[Unit #7]] meets [[Mara#Backstory]]')).toBe('Unit #7 meets Mara');
  });

  it('leaves escaped wiki links as written', () => {
    expect(wikiLinksAsText('not \\[[Literal]] but [[Mara]]\n\\[[Unit #7|Seven]]'))
      .toBe('not \\[[Literal]] but Mara\n\\[[Unit #7|Seven]]');
  });
});
