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
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
const IMAGE_EMBED = /!\[\[([^\]]+)\]\]/g;
const IMAGE_LINE = /^\s*(?:!\[\[[^\]]+\]\]\s*)+$/;

/**
 * Notes escaping. A notes line the parser would read as something else (a
 * `##` variant, an image line, a fence that would take the prompt or never
 * close) or a blank line at the start or end of the notes (which reading
 * trims) is written with one leading backslash: `\## Golden hour`, `\```prompt`,
 * `\`. A line that already starts with backslashes before such a construct
 * gets one more. Reading strips exactly one, so notes round-trip losslessly.
 */
function isEscapable(text: string): boolean {
  return !text.trim() || SECTION_HEADING.test(text) || FENCE_OPEN.test(text) || IMAGE_LINE.test(text);
}

function isEscapedNotesLine(line: string): boolean {
  return line.startsWith('\\') && isEscapable(line.replace(/^\\+/, ''));
}

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

/** Extracts the path from an embed target such as `img/a.png|300`. */
function embedPath(target: string): string {
  return target.split('|')[0].trim();
}

function closesFence(line: string, marker: string): boolean {
  const close = line.match(FENCE_CLOSE);
  return !!close && close[1][0] === marker[0] && close[1].length >= marker.length;
}

/** Parses a prompt file's Markdown body (no frontmatter) into sections. */
export function parsePromptBody(body: string): PromptSection[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const sections: PromptSection[] = [];
  let current = emptyPromptSection();
  // Raw notes lines; escaped lines are unescaped after the blank-line trim,
  // so an escaped blank line at either end survives it.
  let notes: string[] = [];
  let escaped = new Set<number>();

  const finishSection = () => {
    let start = 0;
    let end = notes.length;
    while (start < end && !notes[start].trim()) start++;
    while (end > start && !notes[end - 1].trim()) end--;
    const kept: string[] = [];
    for (let i = start; i < end; i++) kept.push(escaped.has(i) ? notes[i].slice(1) : notes[i]);
    current.notes = kept.join('\n');
    sections.push(current);
  };

  let fence: { marker: string; info: string; raw: string[]; content: string[] } | null = null;

  for (const line of lines) {
    if (fence) {
      if (closesFence(line, fence.marker)) {
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
      current = emptyPromptSection(decodeSectionName(heading[1]));
      notes = [];
      escaped = new Set<number>();
      continue;
    }

    if (IMAGE_LINE.test(line)) {
      for (const match of line.matchAll(IMAGE_EMBED)) {
        const path = embedPath(match[1]);
        if (path) current.images.push(path);
      }
      continue;
    }

    if (isEscapedNotesLine(line)) escaped.add(notes.length);
    notes.push(line);
  }

  // An unterminated fence is kept as plain text rather than dropped.
  if (fence) notes.push(...fence.raw);
  finishSection();
  return sections;
}

/**
 * Body of a file whose frontmatter `parseMarkdown()` already accepted, without
 * the whitespace trim `parseMarkdown()` applies. Trimming would strip the
 * indent of the first notes line, so `  ## Golden hour` would come back as a
 * `##` variant (and `    ```prompt` as a prompt block).
 */
function untrimmedBody(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n');
  const start = text.trimStart();
  if (!start.startsWith('---')) return text;
  const lines = start.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return lines.slice(i + 1).join('\n');
  }
  return '';
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
    sections: parsePromptBody(untrimmedBody(raw)),
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

/**
 * Escapes the notes lines the parser would not give back as written (see
 * `isEscapable()`). A fenced block in the notes is written as is only when the
 * parser keeps it as notes: it closes within the notes and is not a
 * `prompt` / `negative` block. Otherwise its opening line is escaped and the
 * lines after it are handled one by one.
 */
function escapeNotes(notes: string): string {
  const lines = notes.split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && !lines[first].trim()) first++;
  while (last >= first && !lines[last].trim()) last--;

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.match(FENCE_OPEN);
    if (open) {
      const info = open[2].toLowerCase();
      const close =
        info === PROMPT_BLOCK || info === NEGATIVE_BLOCK
          ? -1
          : lines.findIndex((candidate, j) => j > i && closesFence(candidate, open[1]));
      if (close !== -1) {
        out.push(...lines.slice(i, close + 1));
        i = close;
        continue;
      }
    }
    const boundaryBlank = !line.trim() && (i < first || i > last);
    const special = !!open || SECTION_HEADING.test(line) || IMAGE_LINE.test(line);
    out.push(boundaryBlank || special || isEscapedNotesLine(line) ? `\\${line}` : line);
  }
  return out.join('\n');
}

/**
 * Variant name escaping. A heading drops whitespace around the name, so
 * leading and trailing whitespace is written as numeric character references
 * (`## &#32;Keeper portrait C#&#32;`). A name whose own text starts or ends
 * with something that looks like one (`&#32;`, `&amp;#32;`…) gets one more
 * `amp;` there, and reading removes exactly one.
 */
const NAME_ESCAPE_START = /^&((?:amp;)*#\d+;)/;
const NAME_ESCAPE_END = /&((?:amp;)*#\d+;)$/;
const NAME_ESCAPED_START = /^&amp;((?:amp;)*#\d+;)/;
const NAME_ESCAPED_END = /&amp;((?:amp;)*#\d+;)$/;

function whitespaceRefs(text: string): string {
  return Array.from(text, (char) => `&#${char.codePointAt(0)};`).join('');
}

function encodeSectionName(name: string): string {
  const core = name.trim();
  if (!core) return whitespaceRefs(name);
  const lead = name.slice(0, name.length - name.trimStart().length);
  const trail = name.slice(name.trimEnd().length);
  let text = core.replace(NAME_ESCAPE_START, '&amp;$1');
  const end = text.match(NAME_ESCAPE_END);
  if (end && end.index! > 0) text = `${text.slice(0, end.index)}&amp;${end[1]}`;
  return whitespaceRefs(lead) + text + whitespaceRefs(trail);
}

/** Character for `&#<code>;` when it is whitespace, else null. */
function whitespaceRef(code: string): string | null {
  const value = Number(code);
  if (!Number.isInteger(value) || value > 0x10ffff) return null;
  const char = String.fromCodePoint(value);
  return /^\s$/.test(char) ? char : null;
}

function decodeSectionName(raw: string): string {
  let text = raw;
  let lead = '';
  let trail = '';
  for (let m = text.match(/^&#(\d+);/); m; m = text.match(/^&#(\d+);/)) {
    const char = whitespaceRef(m[1]);
    if (char === null) break;
    lead += char;
    text = text.slice(m[0].length);
  }
  for (let m = text.match(/&#(\d+);$/); m; m = text.match(/&#(\d+);$/)) {
    const char = whitespaceRef(m[1]);
    if (char === null) break;
    trail = char + trail;
    text = text.slice(0, m.index);
  }
  text = text.replace(NAME_ESCAPED_START, '&$1');
  const end = text.match(NAME_ESCAPED_END);
  if (end && end.index! > 0) text = `${text.slice(0, end.index)}&${end[1]}`;
  return lead + text + trail;
}

/**
 * Heading line for a variant (name escaped as above). A name ending in `#`
 * gets a closing ` #`, so the parser strips that instead of the name's own `#`
 * (`## Keeper portrait C# #`).
 */
function sectionHeading(name: string): string {
  const text = name ? encodeSectionName(name) : UNTITLED_SECTION;
  return text.endsWith('#') ? `## ${text} #` : `## ${text}`;
}

function serializeSection(section: PromptSection): string {
  const parts: string[] = [];
  const notes = section.notes ? escapeNotes(section.notes) : '';
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
    const heading = sectionHeading(section.name);
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
