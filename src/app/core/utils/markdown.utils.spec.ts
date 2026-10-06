import { markdownToHtml } from './markdown.utils';

describe('Markdown rendering', () => {
  it('keeps list markers from turning subsequent headings italic', () => {
    const html = markdownToHtml('* Sonrisa cálida\n\n## Características clave\n\n* Inteligente y curiosa');
    expect(html).toContain('<h2>Características clave</h2>');
    expect(html).toContain('<ul><li><p>Sonrisa cálida</p></li></ul>');
    expect(html).toContain('<li><p>Inteligente y curiosa</p></li>');
    expect(html).not.toContain('<em>');
  });

  it('renders all six heading levels as separate blocks without extra line breaks', () => {
    for (let depth = 1; depth <= 6; depth++) {
      expect(markdownToHtml(`Before\n${'#'.repeat(depth)} Heading\nAfter`))
        .toBe(`<p>Before</p><h${depth}>Heading</h${depth}><p>After</p>`);
    }
  });

  it('keeps explicit inline emphasis inside its own block', () => {
    expect(markdownToHtml('*Sonrisa cálida*\n\n## **Características** clave'))
      .toBe('<p><em>Sonrisa cálida</em></p><h2><strong>Características</strong> clave</h2>');
    expect(markdownToHtml('*unfinished\n\n## Heading\n\nending*')).not.toContain('<em>');
  });

  it('leaves Markdown syntax inside code untouched', () => {
    const html = markdownToHtml('```\n## Heading\n**bold**\n```\n\n`*code*`');
    expect(html).toBe('<pre><code>## Heading\n**bold**</code></pre><p><code>*code*</code></p>');
  });

  it('escapes raw HTML and blocks unsafe link protocols', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).not.toContain('<script>');
    expect(markdownToHtml('[bad](javascript:alert%281%29)')).not.toContain('href=');
    expect(markdownToHtml('[safe](https://example.com?q=a&b=c)')).toContain('href="https://example.com?q=a&amp;b=c"');
  });

  it('renders reference links, blockquotes and ordered lists', () => {
    const html = markdownToHtml('> A quote\n\n3. Third\n4. Fourth\n\n[reference][ref]\n\n[ref]: https://example.com');
    expect(html).toContain('<blockquote><p>A quote</p></blockquote>');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('href="https://example.com"');
  });
});
