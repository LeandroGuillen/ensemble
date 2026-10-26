import { EditorSelection, StateCommand } from '@codemirror/state';

/** Toggle an inline marker (`**`, `*`, `~~`) around each selection, or insert an empty pair. */
export function toggleInlineMarker(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const size = marker.length;
    const transaction = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - size, range.from);
      const after = state.sliceDoc(range.to, range.to + size);
      if (before === marker && after === marker) {
        return {
          changes: [{ from: range.from - size, to: range.from }, { from: range.to, to: range.to + size }],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }
      return {
        changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    });
    dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input' }));
    return true;
  };
}

/** Wrap each selection in `[[...]]`; with no selection, insert `[[]]` and open completion. */
export const wrapWikiLink: StateCommand = ({ state, dispatch }) => {
  const transaction = state.changeByRange((range) => ({
    changes: [{ from: range.from, insert: '[[' }, { from: range.to, insert: ']]' }],
    range: range.empty ? EditorSelection.cursor(range.from + 2) : EditorSelection.range(range.from + 2, range.to + 2),
  }));
  dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input' }));
  return true;
};
