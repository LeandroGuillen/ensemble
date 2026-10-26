import { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import type { WikiLinkSuggestion } from '../../core/utils/wiki-links.utils';

export type { WikiLinkSuggestion };


/** `[[` completion: inserts `Target]]` (or `Target|Alias]]`) and consumes an auto-closed `]]`. */
export function wikiLinkCompletion(suggestions: () => WikiLinkSuggestion[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^\[\]\n|]*$/);
    if (!match) return null;
    if (match.from > 0 && context.state.sliceDoc(match.from - 1, match.from) === '!') return null;
    const options: Completion[] = suggestions().map((suggestion) => ({
      label: suggestion.label,
      detail: suggestion.detail,
      type: suggestion.type,
      boost: suggestion.boost,
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
        const insert = suggestion.target === suggestion.label
          ? `${suggestion.target}]]`
          : `${suggestion.target}|${suggestion.label}]]`;
        view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.complete' });
      },
    }));
    return { from: match.from + 2, options, validFor: /^[^\[\]\n|]*$/ };
  };
}
