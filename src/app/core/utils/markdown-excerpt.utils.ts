/**
 * `[[Target|Label]]` with any run of backslashes right before it. Not after
 * `!` (embeds) or inside a backslash run (the whole run is captured).
 */
const WIKI_LINK = /(?<![!\\])(\\*)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]*))?\]\]/g;

/**
 * Display text of a wiki link. A `#` directly after a character starts a
 * heading or block fragment (`[[Mara#Backstory]]` -> `Mara`); a `#` after a
 * space is part of the name (`[[Unit #7]]` -> `Unit #7`). An odd number of
 * backslashes escapes the link, which is then left as written.
 */
function wikiLinkReplacement(match: string, slashes: string, target: string, label?: string): string {
  if (slashes.length % 2 === 1) return match;
  const fragment = target.search(/(?<=\S)#/);
  const name = (fragment === -1 ? target : target.slice(0, fragment)).trim();
  return slashes + ((label && label.trim()) || name || target.trim());
}

/**
 * Plain-text previews of Markdown bodies for list cards and rows.
 *
 * Cards should read like prose, not like source: `[[Target|Label]]` becomes
 * `Label`, `[text](url)` becomes `text`, emphasis/heading/list/quote markers
 * and embeds are dropped, and whitespace is collapsed to single spaces. The
 * result is cut on a word boundary and ends with an ellipsis when shortened.
 */
export function markdownExcerpt(content: string | null | undefined, maxLength = 160): string {
  if (!content) return '';
  let text = content
    // Fenced code blocks and HTML comments carry no preview value.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Embeds: ![[image.png]] and ![alt](src)
    .replace(/!\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    // Wiki links: [[Target|Label]] -> Label, [[Target#Heading]] -> Target, \[[Literal]] kept
    .replace(WIKI_LINK, wikiLinkReplacement)
    // Markdown links: [text](url) -> text
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    // Inline code
    .replace(/`([^`\n]+)`/g, '$1')
    // Line-leading block markers: headings, quotes, list bullets, task boxes
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    // Horizontal rules
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, ' ')
    // Emphasis / strike / highlight markers
    .replace(/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    // Simple inline HTML tags
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  text = (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–—]+$/, '');
  return `${text}…`;
}

/**
 * Show `[[Target|Label]]` wiki links as their display text while keeping the
 * rest of the text (including line breaks) untouched. For short cells such as
 * plot-board beats, where the raw link syntax would otherwise leak into view.
 */
export function wikiLinksAsText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(WIKI_LINK, wikiLinkReplacement);
}
