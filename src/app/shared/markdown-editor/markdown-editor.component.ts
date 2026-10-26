import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  forwardRef,
  inject,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, StateEffect } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { toggleInlineMarker, wrapWikiLink } from './formatting-commands';
import { WikiLinkResolver, livePreview } from './live-preview';
import { WikiLinkSuggestion, wikiLinkCompletion } from './wikilink-completion';

export type { WikiLinkSuggestion } from './wikilink-completion';
export type { WikiLinkResolver } from './live-preview';

/** Forces a decoration rebuild when link targets change outside the document. */
const refreshLinks = StateEffect.define<null>();

const markdownHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.875em' },
  { tag: tags.processingInstruction, color: 'var(--color-text-muted)' },
  { tag: [tags.url, tags.link], color: 'var(--color-text-muted)' },
  { tag: tags.quote, color: 'var(--color-text-secondary)' },
  { tag: tags.contentSeparator, color: 'var(--color-text-muted)' },
]);

const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--color-text-primary)',
    backgroundColor: 'transparent',
    fontSize: '1.0625rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.7', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'var(--color-accent-primary)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent-primary)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-primary) 28%, transparent) !important',
  },
  '.cm-placeholder': { color: 'var(--color-text-muted)', fontStyle: 'italic' },
  '.cm-md-heading': { fontWeight: '600', lineHeight: '1.35', color: 'var(--color-text-primary)' },
  '.cm-md-h1': { fontSize: '1.625rem', paddingTop: '0.6em !important' },
  '.cm-md-h2': { fontSize: '1.375rem', paddingTop: '0.5em !important' },
  '.cm-md-h3': { fontSize: '1.125rem', paddingTop: '0.4em !important' },
  '.cm-md-h4, .cm-md-h5, .cm-md-h6': { fontSize: '1rem', paddingTop: '0.3em !important' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--color-border-light)',
    paddingLeft: '1em !important',
    color: 'var(--color-text-secondary)',
  },
  '.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875em',
    backgroundColor: 'var(--color-bg-secondary)',
    padding: '0 0.75em !important',
  },
  '.cm-md-hr': { color: 'var(--color-text-muted)' },
  '.cm-md-bullet': { color: 'var(--color-text-muted)', padding: '0 0.25em' },
  '.cm-md-link': { color: 'var(--color-accent-primary)', textDecoration: 'underline' },
  '.cm-wikilink': {
    color: 'var(--color-accent-primary)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    textDecorationColor: 'color-mix(in srgb, var(--color-accent-primary) 45%, transparent)',
  },
  // Link labels may contain highlighter spans (e.g. the Markdown "link" tag); keep the link color.
  '.cm-wikilink *, .cm-md-link *': { color: 'inherit' },
  '.cm-wikilink-missing, .cm-wikilink-ambiguous': {
    color: 'var(--color-text-muted)',
    textDecorationStyle: 'dashed',
  },
  '&.cm-link-modifier .cm-wikilink[data-href]': { cursor: 'pointer' },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-sans)', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', color: 'var(--color-text-secondary)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-bg-hover)',
    color: 'var(--color-text-primary)',
  },
  '.cm-completionDetail': { marginLeft: '0.75em', fontStyle: 'normal', color: 'var(--color-text-muted)', fontSize: '0.85em' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--color-accent-primary)' },
  '.cm-panels': { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', borderRadius: 'var(--radius-md)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)', position: 'sticky', top: '0' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-accent-primary) 45%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-accent-primary) 14%, transparent)' },
});

/**
 * Markdown editor (CodeMirror 6) with Obsidian-style live preview and [[wikilink]] support.
 * Works as a form control (formControlName / ngModel). Ctrl/Cmd+click on a link emits `linkOpen`.
 */
@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  template: '',
  styleUrl: './markdown-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MarkdownEditorComponent), multi: true }],
})
export class MarkdownEditorComponent implements ControlValueAccessor, OnInit, OnChanges, OnDestroy {
  @Input() placeholder = '';
  @Input() linkResolver: WikiLinkResolver | null = null;
  @Input() linkSuggestions: WikiLinkSuggestion[] = [];
  /** Hash route of a Ctrl/Cmd+clicked wikilink. */
  @Output() linkOpen = new EventEmitter<string>();
  @Output() editorBlur = new EventEmitter<void>();

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private view: EditorView | null = null;
  private readonly editable = new Compartment();
  private disabled = false;
  private readonly placeholderCompartment = new Compartment();
  private pendingValue = '';
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      this.view = new EditorView({
        parent: this.host.nativeElement,
        state: EditorState.create({ doc: this.pendingValue, extensions: this.extensions() }),
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.view) return;
    if (changes['placeholder']) {
      this.view.dispatch({ effects: this.placeholderCompartment.reconfigure(placeholder(this.placeholder)) });
    }
    if (changes['linkResolver']) {
      this.view.dispatch({ effects: refreshLinks.of(null) });
    }
  }

  ngOnDestroy(): void {
    this.view?.destroy();
    this.view = null;
  }

  focus(): void {
    this.view?.focus();
  }

  writeValue(value: string | null): void {
    const text = value ?? '';
    if (!this.view) {
      this.pendingValue = text;
      return;
    }
    if (this.view.state.doc.toString() === text) return;
    // External value (load, reset, reload from disk): start a fresh state so it neither
    // emits a change nor becomes undoable.
    const hadFocus = this.view.hasFocus;
    this.view.setState(EditorState.create({ doc: text, extensions: this.extensions() }));
    if (hadFocus) this.view.focus();
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    this.view?.dispatch({ effects: this.editable.reconfigure(EditorView.editable.of(!disabled)) });
  }

  private extensions() {
    const formattingKeymap = keymap.of([
      { key: 'Mod-b', run: toggleInlineMarker('**') },
      { key: 'Mod-i', run: toggleInlineMarker('*') },
      { key: 'Mod-Shift-x', run: toggleInlineMarker('~~') },
      { key: 'Mod-k', run: wrapWikiLink },
    ]);
    // Ctrl/Cmd+Enter belongs to the page (save); never let the editor consume it.
    const baseKeymap = defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter');
    return [
      history(),
      drawSelection(),
      dropCursor(),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(markdownHighlight),
      closeBrackets(),
      autocompletion({ override: [wikiLinkCompletion(() => this.linkSuggestions)], icons: false }),
      search({ top: true }),
      highlightSelectionMatches(),
      Prec.high(formattingKeymap),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...baseKeymap, indentWithTab]),
      this.editable.of(EditorView.editable.of(!this.disabled)),
      this.placeholderCompartment.of(placeholder(this.placeholder)),
      livePreview(() => this.linkResolver),
      editorTheme,
      EditorView.domEventHandlers({
        mousedown: (event) => {
          if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
          const link = (event.target as HTMLElement | null)?.closest<HTMLElement>('.cm-wikilink[data-href]');
          const href = link?.dataset['href'];
          if (!href) return false;
          event.preventDefault();
          this.zone.run(() => this.linkOpen.emit(href));
          return true;
        },
        keydown: (event, view) => {
          view.dom.classList.toggle('cm-link-modifier', event.ctrlKey || event.metaKey);
          return false;
        },
        keyup: (event, view) => {
          view.dom.classList.toggle('cm-link-modifier', event.ctrlKey || event.metaKey);
          return false;
        },
        blur: (_event, view) => {
          view.dom.classList.remove('cm-link-modifier');
          this.zone.run(() => {
            this.onTouched();
            this.editorBlur.emit();
          });
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const value = update.state.doc.toString();
        this.zone.run(() => this.onChange(value));
      }),
    ];
  }
}
