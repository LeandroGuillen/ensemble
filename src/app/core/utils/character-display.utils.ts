import { Character } from '../interfaces/character.interface';

/** Human-readable identity for records that are allowed to have no name while drafting. */
export function getCharacterDisplayName(character: Character): string {
  const name = character.name?.trim();
  if (name) return name;
  const suffix = character.id.slice(-4).toUpperCase();
  return `Unnamed draft${suffix ? ` · ${suffix}` : ''}`;
}

/**
 * Collapse a Markdown/wiki body to readable plain text for list previews.
 * `[[targets]]` become their label, common Markdown syntax is dropped and
 * whitespace is collapsed so cards never leak raw markup.
 */
export function plainTextSummary(content: string | undefined | null, maxLength: number): string {
  if (!content) return '';
  const text = content
    // Wiki links: [[target|label]] -> label, [[target]] -> target
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => (label ?? target).trim())
    // Markdown links/images: [text](url) -> text, ![alt](url) -> alt
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Code fences and inline code markers
    .replace(/```[a-zA-Z0-9]*/g, '')
    .replace(/`/g, '')
    // Emphasis and strikethrough markers
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    // Heading and blockquote prefixes
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    // List bullets
    .replace(/^\s{0,3}[-+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

