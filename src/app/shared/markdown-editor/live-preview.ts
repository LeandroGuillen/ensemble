import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import type { ResolvedWikiLink } from '../../core/utils/wiki-links.utils';

export type WikiLinkResolver = (target: string) => ResolvedWikiLink | null;

/** Same wikilink syntax as the Markdown renderer: no embeds (`![[`) or escaped links. */
export const WIKI_LINK_PATTERN = /(?<!!|\\)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]*))?\]\]/g;

const hidden = Decoration.replace({});

class BulletWidget extends WidgetType {
  override eq(): boolean { return true; }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '•';
    return span;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

/** Lines touched by a selection keep their raw Markdown visible while the editor has focus. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc, selection } = view.state;
  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

function lineClasses(state: EditorState, from: number, to: number, cls: string, out: Range<Decoration>[]): void {
  const deco = Decoration.line({ class: cls });
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    out.push(deco.range(line.from));
    pos = line.to + 1;
  }
}

function buildDecorations(view: EditorView, resolve: () => WikiLinkResolver | null): DecorationSet {
  const { state } = view;
  const active = activeLines(view);
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const code: { from: number; to: number }[] = [];
  // View plugins may not replace line breaks (CodeMirror throws and the editor stops
  // rendering), so syntax spanning lines, e.g. `[label](\nurl)`, stays visible.
  const replace = (deco: Decoration, from: number, to: number) => {
    if (to > from && state.doc.lineAt(from).to >= to) out.push(deco.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          lineClasses(state, node.from, node.to, `cm-md-heading cm-md-h${heading[1]}`, out);
          return;
        }
        switch (name) {
          case 'FencedCode':
          case 'CodeBlock':
            code.push({ from: node.from, to: node.to });
            lineClasses(state, node.from, node.to, 'cm-md-codeblock', out);
            return false;
          case 'InlineCode':
            code.push({ from: node.from, to: node.to });
            return;
          case 'Blockquote':
            lineClasses(state, node.from, node.to, 'cm-md-quote', out);
            return;
          case 'HorizontalRule':
            lineClasses(state, node.from, node.to, 'cm-md-hr', out);
            return;
          case 'HeaderMark': {
            if (isActive(node.from) || node.node.parent?.name.startsWith('Setext')) return;
            const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            replace(hidden, node.from, end);
            return;
          }
          case 'QuoteMark': {
            if (isActive(node.from)) return;
            const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            replace(hidden, node.from, end);
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'CodeMark':
            if (!isActive(node.from)) replace(hidden, node.from, node.to);
            return;
          case 'ListMark':
            if (!isActive(node.from) && node.node.parent?.parent?.name === 'BulletList' &&
                !/^\s*\[[ xX]\]/.test(state.doc.sliceString(node.to, node.to + 5))) {
              replace(bullet, node.from, node.to);
            }
            return;
          case 'Link': {
            // [label](url): show only the label away from the cursor line.
            const marks = node.node.getChildren('LinkMark');
            if (marks.length < 2 || state.doc.sliceString(marks[0].from, marks[0].to) !== '[') return;
            if (marks[1].from > marks[0].to) {
              out.push(Decoration.mark({ class: 'cm-md-link' }).range(marks[0].to, marks[1].from));
            }
            if (isActive(node.from)) return;
            replace(hidden, marks[0].from, marks[0].to);
            replace(hidden, marks[1].from, node.to);
            return false;
          }
        }
        return;
      },
    });

    const resolver = resolve();
    const text = state.doc.sliceString(from, to);
    for (const match of text.matchAll(WIKI_LINK_PATTERN)) {
      const start = from + match.index!;
      const end = start + match[0].length;
      if (code.some((range) => start < range.to && end > range.from)) continue;
      const target = match[1].trim();
      if (!target) continue;
      const link = resolver?.(target) ?? null;
      const state_ = link?.state ?? 'resolved';
      const attributes: Record<string, string> = { title: link?.title ?? target };
      if (link?.href) {
        attributes['data-href'] = link.href;
        attributes['title'] += ` — ${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}+click to open`;
      }
      const mark = Decoration.mark({ class: `cm-wikilink cm-wikilink-${state_}`, attributes });
      if (isActive(start)) {
        out.push(mark.range(start, end));
        continue;
      }
      const labelFrom = match[2] !== undefined ? start + 2 + match[1].length + 1 : start + 2;
      const labelTo = end - 2;
      if (labelTo <= labelFrom) continue;
      replace(hidden, start, labelFrom);
      out.push(mark.range(labelFrom, labelTo));
      replace(hidden, labelTo, end);
    }
  }
  return Decoration.set(out, true);
}

/**
 * Obsidian-style live preview: Markdown syntax is hidden except on the lines holding the
 * cursor, headings/quotes/code get line styling and [[wikilinks]] render as links.
 */
export function livePreview(resolve: () => WikiLinkResolver | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, resolve);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged ||
            update.transactions.some((tr) => tr.reconfigured) || syntaxTree(update.startState) !== syntaxTree(update.state) ||
            update.transactions.some((tr) => tr.effects.length)) {
          this.decorations = buildDecorations(update.view, resolve);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}
