import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent } from 'mdast';
import { parseBookPlan } from './book-plan.utils';

export interface PlanLinkCharacter {
  id: string;
  name: string;
  aliases?: string[];
  target: string;
}
export interface PlanLinkAmbiguity {
  chapter: string;
  line: number;
  text: string;
  mention: string;
  candidates: string[];
  reason: string;
  /** A unique shortened name can be explicitly selected in the preview. */
  change?: { from: number; to: number; insert: string };
  selected?: boolean;
}
export interface PlanCharacterLinkScan {
  text: string;
  count: number;
  changes: { from: number; to: number; insert: string }[];
  ambiguous: PlanLinkAmbiguity[];
}
// Ordinary English/Spanish words cannot stand alone as character mentions.
const COMMON_WORDS = new Set(('will may can rose hope grace faith joy summer autumn winter spring dawn ' +
  'mark bill pat robin ash reed clay brook river sky rain snow storm stone amber pearl jade ruby ' +
  'chase hunter grant drew rob art frank earnest august chance destiny harmony ' +
  'a an the in on at to of for and or is as no yes he she it we you they ' +
  'el la los las un una de del en con por para y o si sí sol luz mar paz flor alma blanca rosa abril mayo julio').split(' '));
const parser = unified().use(remarkParse);
const word = /[\p{L}\p{N}\p{M}_]/u;

/** Scan source offsets without serializing Markdown, so everything except inserted links stays byte-for-byte intact. */
export function scanPlanCharacterLinks(text: string, characters: PlanLinkCharacter[], otherNames: string[] = []): PlanCharacterLinkScan {
  const protectedRanges: { from: number; to: number }[] = [];
  const visit = (node: Root | RootContent): void => {
    if (['heading', 'code', 'inlineCode', 'html', 'link', 'linkReference', 'image', 'imageReference', 'definition'].includes(node.type)) {
      if (node.position) protectedRanges.push({ from: node.position.start.offset!, to: node.position.end.offset! });
      return;
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(parser.parse(text));
  // Include escaped links, embeds and unfinished links: never nest a generated link inside them.
  for (const match of text.matchAll(/\[\[[^\n]*?(?:\]\]|$)|%%[\s\S]*?(?:%%|$)|^---\r?\n[\s\S]*?\n---(?:\r?\n|$)/gm)) {
    protectedRanges.push({ from: match.index!, to: match.index! + match[0].length });
  }
  const parsed = parseBookPlan(text);
  const markedLines = new Set(parsed.lines.filter(line => line.markers.length).map(line => line.line));
  const terms = new Map<string, Map<string, PlanLinkCharacter>>();
  const explicit = new Set<string>();
  const add = (name: string, character: PlanLinkCharacter, isExplicit: boolean) => {
    name = name.trim();
    if (!name || /[\n\r|\[\]]/.test(name) || COMMON_WORDS.has(name.toLowerCase())) return;
    const entries = terms.get(name) ?? new Map();
    entries.set(character.id, character);
    terms.set(name, entries);
    if (isExplicit) explicit.add(name);
  };
  for (const character of characters) {
    add(character.name, character, true);
    for (const alias of character.aliases ?? []) add(alias, character, true);
    const first = character.name.trim().split(/\s+/)[0];
    if (first !== character.name) add(first, character, false);
  }
  const labels = [...terms.keys()].sort((a, b) => b.length - a.length);
  if (!labels.length) return { text, count: 0, changes: [], ambiguous: [] };
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(labels.map(escape).join('|'), 'gu');
  const collisions = new Set(otherNames.map(name => name.trim().toLowerCase()));
  const ambiguous: PlanLinkAmbiguity[] = [];
  const edits: { from: number; to: number; insert: string }[] = [];
  let offset = 0;
  const lines = text.split('\n');
  lines.forEach((raw, line) => {
    const start = offset;
    offset += raw.length + 1;
    if (markedLines.has(line) || /^\s*(?:#{1,6}\s|PoV:|When:)/i.test(raw)) return;
    for (const match of raw.matchAll(pattern)) {
      const mention = match[0];
      const from = start + match.index!;
      const to = from + mention.length;
      const before = Array.from(text.slice(Math.max(0, from - 2), from)).pop() ?? '';
      const after = Array.from(text.slice(to, to + 2))[0] ?? '';
      if (word.test(before) || word.test(after)) continue;
      if (protectedRanges.some(range => from < range.to && to > range.from)) continue;
      const candidates = [...terms.get(mention)!.values()];
      const reason = candidates.length > 1 ? 'Multiple characters'
        : collisions.has(mention.toLowerCase()) ? 'Location or House with the same name'
        : !explicit.has(mention) ? 'Shortened name; confirm the character' : '';
      const target = candidates[0].target;
      const change = { from, to, insert: target === mention ? `[[${target}]]` : `[[${target}|${mention}]]` };
      if (reason) {
        const chapter = parsed.chapters.find(chapter => line >= chapter.line && line < chapter.endLine);
        const suggestion = candidates.length === 1 && !collisions.has(mention.toLowerCase()) && !explicit.has(mention)
          ? { change, selected: false } : {};
        ambiguous.push({ ...suggestion, chapter: chapter?.heading ?? 'Outside a chapter', line, text: raw, mention,
          candidates: candidates.map(candidate => candidates.filter(c => c.name === candidate.name).length > 1 ? `${candidate.name} (${candidate.id})` : candidate.name), reason });
      } else {
        edits.push(change);
      }
    }
  });
  let result = text;
  for (const edit of [...edits].reverse()) result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  return { text: result, count: edits.length, changes: edits, ambiguous };
}
