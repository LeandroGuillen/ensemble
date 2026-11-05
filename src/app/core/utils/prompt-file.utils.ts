import { CharacterPrompt } from '../interfaces/character.interface';
import { PromptFile, PromptFileData, PromptSection } from '../interfaces/prompt.interface';
import { generateMarkdown, parseMarkdown } from './markdown.utils';

/** Fence info strings Ensemble reads as prompt blocks. */
export const PROMPT_BLOCK = 'prompt';
export const NEGATIVE_BLOCK = 'negative';

/** Heading written for a named section whose name was left empty. */
const UNTITLED_SECTION = 'Untitled';

const MANAGED_KEYS = new Set(['characters', 'locations', 'tags', 'created', 'modified']);

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const SECTION_HEADING = /^##(?!#)\s*(.*?)\s*#*\s*$/;
const IMAGE_EMBED = /!\[\[([^\]]+)\]\]/g;
const IMAGE_LINE = /^\s*(?:!\[\[[^\]]+\]\]\s*)+$/;

export function emptyPromptSection(name = ''): PromptSection {
  return { name, notes: '', prompt: null, negative: null, images: [] };
}

export function emptyPromptFileData(): PromptFileData {
  return { characters: [], locations: [], tags: [], extra: {}, sections: [emptyPromptSection()] };
}

/** True when a section carries anything worth showing. */
export function isPromptSectionEmpty(section: PromptSection): boolean {
  return (
    !section.notes.trim() &&
    section.prompt === null &&
    section.negative === null &&
    section.images.length === 0
  );
}

/** Sections that hold a prompt block, i.e. the variants a user can copy. */
export function promptVariants(file: Pick<PromptFileData, 'sections'>): PromptSection[] {
  return file.sections.filter((section) => section.prompt !== null);
}

/** First image of the file, used as its cover. */
export function promptCoverImage(file: Pick<PromptFileData, 'sections'>): string | null {
  for (const section of file.sections) {
    if (section.images.length > 0) return section.images[0];
  }
  return null;
}

/** Lowercased text searched by the prompt library (name, tags, notes and prompts). */
export function promptSearchText(file: PromptFile): string {
  const parts: string[] = [file.relativePath, ...file.tags];
  for (const section of file.sections) {
    parts.push(section.name, section.notes, section.prompt ?? '', section.negative ?? '');
  }
  return parts.join('\n').toLowerCase();
}

function toStringList(raw: unknown): string[] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const value = String(item).trim();
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end).join('\n');
}

/** Extracts the path from an embed target such as `img/a.png|300`. */
function embedPath(target: string): string {
  return target.split('|')[0].trim();
}

/** Parses a prompt file's Markdown body (no frontmatter) into sections. */
export function parsePromptBody(body: string): PromptSection[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const sections: PromptSection[] = [];
  let current = emptyPromptSection();
  let notes: string[] = [];

  const finishSection = () => {
    current.notes = trimBlankLines(notes);
    sections.push(current);
  };

  let fence: { marker: string; info: string; raw: string[]; content: string[] } | null = null;

  for (const line of lines) {
    if (fence) {
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
        const content = fence.content.join('\n');
        if (fence.info === PROMPT_BLOCK && current.prompt === null) {
          current.prompt = content;
        } else if (fence.info === NEGATIVE_BLOCK && current.negative === null) {
          current.negative = content;
        } else {
          notes.push(...fence.raw, line);
        }
        fence = null;
      } else {
        fence.raw.push(line);
        fence.content.push(line);
      }
      continue;
    }

    const open = line.match(FENCE_OPEN);
    if (open) {
      fence = { marker: open[1], info: open[2].toLowerCase(), raw: [line], content: [] };
      continue;
    }

    const heading = line.match(SECTION_HEADING);
    if (heading) {
      finishSection();
      current = emptyPromptSection(heading[1]);
      notes = [];
      continue;
    }

    if (IMAGE_LINE.test(line)) {
      for (const match of line.matchAll(IMAGE_EMBED)) {
        const path = embedPath(match[1]);
        if (path) current.images.push(path);
      }
      continue;
    }

    notes.push(line);
  }

  // An unterminated fence is kept as plain text rather than dropped.
  if (fence) notes.push(...fence.raw);
  finishSection();
  return sections;
}

/** Parses a whole prompt file, frontmatter included. Throws on malformed frontmatter. */
export function parsePromptFile(raw: string): PromptFileData {
  const parsed = parseMarkdown<Record<string, unknown>>(raw);
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error || 'Could not parse prompt file');
  }
  const frontmatter =
    parsed.data.frontmatter && typeof parsed.data.frontmatter === 'object'
      ? parsed.data.frontmatter
      : {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!MANAGED_KEYS.has(key)) extra[key] = value;
  }
  const timestamp = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

  return {
    characters: toStringList(frontmatter['characters']),
    locations: toStringList(frontmatter['locations']),
    tags: toStringList(frontmatter['tags']),
    created: timestamp(frontmatter['created']),
    modified: timestamp(frontmatter['modified']),
    extra,
    sections: parsePromptBody(parsed.data.content || ''),
  };
}

/** Shortest backtick fence that cannot be closed by the content itself. */
function fenceFor(content: string): string {
  let longest = 0;
  for (const match of content.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function serializeBlock(info: string, content: string): string {
  const fence = fenceFor(content);
  return `${fence}${info}\n${content}\n${fence}`;
}

function serializeSection(section: PromptSection): string {
  const parts: string[] = [];
  const notes = section.notes.trim() ? trimBlankLines(section.notes.split('\n')) : '';
  if (notes) parts.push(notes);
  const blocks: string[] = [];
  if (section.prompt !== null) blocks.push(serializeBlock(PROMPT_BLOCK, section.prompt));
  if (section.negative !== null) blocks.push(serializeBlock(NEGATIVE_BLOCK, section.negative));
  if (blocks.length) parts.push(blocks.join('\n'));
  const images = section.images.map((path) => path.trim()).filter(Boolean);
  if (images.length) parts.push(images.map((path) => `![[${path}]]`).join('\n'));
  return parts.join('\n\n');
}

/** Serializes the body: main section first, then one `##` heading per variant. */
export function serializePromptBody(sections: PromptSection[]): string {
  const [main, ...named] = sections.length ? sections : [emptyPromptSection()];
  const chunks: string[] = [];
  const mainText = serializeSection(main);
  if (mainText) chunks.push(mainText);
  for (const section of named) {
    const heading = `## ${section.name.trim() || UNTITLED_SECTION}`;
    const body = serializeSection(section);
    chunks.push(body ? `${heading}\n\n${body}` : heading);
  }
  return chunks.length ? `${chunks.join('\n\n')}\n` : '';
}

export function serializePromptFile(data: PromptFileData): string {
  const frontmatter: Record<string, unknown> = { ...data.extra };
  if (data.characters.length) frontmatter['characters'] = [...data.characters];
  if (data.locations.length) frontmatter['locations'] = [...data.locations];
  if (data.tags.length) frontmatter['tags'] = [...data.tags];
  if (data.created) frontmatter['created'] = data.created;
  if (data.modified) frontmatter['modified'] = data.modified;
  return generateMarkdown(frontmatter, serializePromptBody(data.sections));
}

/**
 * Converts legacy character-frontmatter prompts into sections: the first
 * becomes the main section (keeping its name as a note-free heading only when
 * it had one), the rest become `##` variants.
 */
export function sectionsFromCharacterPrompts(prompts: CharacterPrompt[]): PromptSection[] {
  const toSection = (prompt: CharacterPrompt, name: string): PromptSection => ({
    ...emptyPromptSection(name),
    prompt: prompt.positive ?? '',
    negative: prompt.negative?.trim() ? prompt.negative : null,
  });
  if (prompts.length === 0) return [emptyPromptSection()];
  const [first, ...rest] = prompts;
  const sections: PromptSection[] = [];
  if (first.name?.trim()) {
    sections.push(emptyPromptSection(), toSection(first, first.name.trim()));
  } else {
    sections.push(toSection(first, ''));
  }
  rest.forEach((prompt, index) =>
    sections.push(toSection(prompt, prompt.name?.trim() || `Variant ${index + 2}`))
  );
  return sections;
}
