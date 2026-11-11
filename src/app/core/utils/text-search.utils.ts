/** One searchable page, with enough context to open its owning record. */
export interface TextDocument {
  id: string;
  type: 'Characters' | 'Lore' | 'Drafts' | 'Locations' | 'Houses' | 'Concepts' | 'Name lists' | 'Plot boards';
  title: string;
  text: string;
  route: string[];
  queryParams?: Record<string, string>;
  book?: string;
}
export interface SearchPart { text: string; hit: boolean; }
export interface TextResult extends TextDocument { snippet: SearchPart[]; }

export function foldSearchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Normalization happens once per page; queries never read files. */
export class TextSearchIndex {
  private entries: { document: TextDocument; text: string; folded: string; offsets?: number[] }[] = [];

  replace(documents: TextDocument[]): void {
    this.entries = documents.map(document => {
      const text = `${document.title}\n${document.text}`.replace(/\s+/g, ' ').trim();
      const folded = foldSearchText(text);
      let offsets: number[] | undefined;
      if (folded.length !== text.length) {
        offsets = [];
        let original = 0;
        for (const char of text) {
          for (let i = 0; i < foldSearchText(char).length; i++) offsets.push(original);
          original += char.length;
        }
        offsets.push(text.length);
      }
      return { document, text, folded, offsets };
    });
  }

  search(query: string): TextResult[] {
    const needle = foldSearchText(query.trim()).replace(/\s+/g, ' ');
    if (!needle) return [];
    const results: TextResult[] = [];
    for (const entry of this.entries) {
      const match = entry.folded.indexOf(needle);
      if (match < 0) continue;
      // Map normalized offsets back to the original UTF-16 text. This keeps accents,
      // combining marks and surrogate pairs intact when highlighting a match.
      const start = entry.offsets?.[match] ?? match;
      let end = entry.offsets?.[match + needle.length] ?? match + needle.length;
      while (end < entry.text.length && /\p{M}/u.test(entry.text[end])) end++;
      const left = Math.max(0, start - 65);
      const right = Math.min(entry.text.length, Math.max(end + 85, left + 170));
      results.push({ ...entry.document, snippet: [
        { text: `${left ? '…' : ''}${entry.text.slice(left, start)}`, hit: false },
        { text: entry.text.slice(start, end), hit: true },
        { text: `${entry.text.slice(end, right)}${right < entry.text.length ? '…' : ''}`, hit: false },
      ] });
    }
    return results;
  }
}
