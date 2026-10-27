import { EditorState, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

/** Character range of the document to keep visible; everything else is hidden. */
export interface FocusRange {
  from: number;
  to: number;
}

export const setFocusRange = StateEffect.define<FocusRange | null>();

const collapsed = Decoration.replace({ block: true });

/** Clamp to the document and snap to whole lines. */
function normalize(state: EditorState, range: FocusRange | null): FocusRange | null {
  if (!range) return null;
  const { doc } = state;
  const from = doc.lineAt(Math.max(0, Math.min(range.from, doc.length))).from;
  const toPos = Math.max(from, Math.min(range.to, doc.length));
  // `to` is usually the start of the next section; keep the line before it as the last visible one.
  const toLine = toPos > from && doc.lineAt(toPos).from === toPos ? doc.lineAt(toPos - 1) : doc.lineAt(toPos);
  return { from, to: toLine.to };
}

function decorations(state: EditorState, range: FocusRange | null): DecorationSet {
  if (!range) return Decoration.none;
  const { doc } = state;
  const out: Range<Decoration>[] = [];
  if (range.from > 0) {
    out.push(collapsed.range(0, doc.lineAt(range.from - 1).to));
  }
  if (range.to < doc.length) {
    out.push(collapsed.range(doc.lineAt(range.to + 1).from, doc.length));
  }
  return Decoration.set(out);
}

/**
 * Keeps one range of the document visible (e.g. the current chapter) and hides the rest.
 * The whole document stays in the editor, so undo and search keep working across it.
 * The cursor may leave the range (arrow keys, search); hosts follow it by moving the range.
 * `initial` is read whenever a fresh editor state is created.
 */
export function focusRange(initial: () => FocusRange | null) {
  const field = StateField.define<{ range: FocusRange | null; deco: DecorationSet }>({
    create(state) {
      const range = normalize(state, initial());
      return { range, deco: decorations(state, range) };
    },
    update(value, tr) {
      let range = value.range;
      let changed = false;
      for (const effect of tr.effects) {
        if (effect.is(setFocusRange)) {
          range = effect.value;
          changed = true;
        }
      }
      if (!changed && !tr.docChanged) return value;
      if (!changed && range) {
        // Text typed at either edge stays visible.
        range = { from: tr.changes.mapPos(range.from, -1), to: tr.changes.mapPos(range.to, 1) };
      }
      range = normalize(tr.state, range);
      return { range, deco: decorations(tr.state, range) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.deco),
  });

  return field;
}

export const setHiddenLines = StateEffect.define<FocusRange[]>();

const hiddenLine = Decoration.replace({ block: true });

function hiddenLineDecorations(state: EditorState, ranges: FocusRange[]): DecorationSet {
  const { doc } = state;
  const out: Range<Decoration>[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    if (range.from > doc.length) continue;
    const first = doc.lineAt(range.from);
    const last = doc.lineAt(Math.min(range.to, doc.length));
    const prev = out[out.length - 1];
    if (prev && prev.to >= first.from) continue;
    out.push(hiddenLine.range(first.from, last.to));
  }
  return Decoration.set(out);
}

/**
 * Hides whole lines (e.g. metadata lines such as `PoV:`) without removing them from the document.
 * The cursor skips over them.
 */
export function hiddenLines(initial: () => FocusRange[]) {
  const field = StateField.define<DecorationSet>({
    create: (state) => hiddenLineDecorations(state, initial()),
    update(deco, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setHiddenLines)) return hiddenLineDecorations(tr.state, effect.value);
      }
      return tr.docChanged ? deco.map(tr.changes) : deco;
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });
  return field;
}
