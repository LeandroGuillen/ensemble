import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { toggleInlineMarker, wrapWikiLink } from './formatting-commands';
import { MarkdownEditorComponent } from './markdown-editor.component';
import { wikiLinkCompletion } from './wikilink-completion';

@Component({
  standalone: true,
  imports: [MarkdownEditorComponent, ReactiveFormsModule],
  template: `<app-markdown-editor [formControl]="control" [linkResolver]="resolver" (linkOpen)="opened = $event" />`,
})
class HostComponent {
  control = new FormControl('# Title\n\nSee [[Ben|my friend]] and [[Nobody]].');
  opened = '';
  resolver = (target: string) => target === 'Ben'
    ? { state: 'resolved' as const, href: '#/character/ben', route: 'character', title: 'Ben' }
    : { state: 'missing' as const, href: '#/character?name=Nobody&fromLink=1', route: 'character', title: 'New' };
}

describe('MarkdownEditorComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)!;
    return { fixture, root, view, host: fixture.componentInstance };
  }

  it('renders headings and wikilinks as live preview when not editing that line', () => {
    const { root } = setup();
    const content = root.querySelector('.cm-content')!;
    expect(content.querySelector('.cm-md-h1')?.textContent).toBe('Title');
    const links = Array.from(content.querySelectorAll<HTMLElement>('.cm-wikilink'));
    expect(links.map((link) => link.textContent)).toEqual(['my friend', 'Nobody']);
    expect(links[0].classList).toContain('cm-wikilink-resolved');
    expect(links[1].classList).toContain('cm-wikilink-missing');
  });

  it('syncs edits to the form control and external values back to the editor', () => {
    const { view, host } = setup();
    view.dispatch({ changes: { from: view.state.doc.length, insert: '!' }, userEvent: 'input' });
    expect(host.control.value).toBe('# Title\n\nSee [[Ben|my friend]] and [[Nobody]].!');
    host.control.setValue('Replaced');
    expect(view.state.doc.toString()).toBe('Replaced');
    expect(host.control.dirty).toBeTrue();
  });

  it('opens links on Ctrl+click only', () => {
    const { root, host } = setup();
    const link = root.querySelector<HTMLElement>('.cm-wikilink-resolved')!;
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    expect(host.opened).toBe('');
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true }));
    expect(host.opened).toBe('#/character/ben');
  });

  it('toggles inline markers and wraps wikilinks', () => {
    let state = EditorState.create({ doc: 'word', selection: { anchor: 0, head: 4 } });
    const run = (command: typeof wrapWikiLink) => command({ state, dispatch: (tr) => { state = tr.state; } });
    run(toggleInlineMarker('**'));
    expect(state.doc.toString()).toBe('**word**');
    run(toggleInlineMarker('**'));
    expect(state.doc.toString()).toBe('word');
    run(wrapWikiLink);
    expect(state.doc.toString()).toBe('[[word]]');
  });

  it('completes [[ with names and aliases, consuming the closing brackets', () => {
    const source = wikiLinkCompletion(() => [
      { label: 'Ben', target: 'Ben' },
      { label: 'Benny', target: 'Ben' },
    ]);
    const parent = document.createElement('div');
    const view = new EditorView({ parent, state: EditorState.create({ doc: 'Hi [[Be]]', selection: { anchor: 7 } }) });
    const result = source(new CompletionContext(view.state, 7, true)) as CompletionResult;
    expect(result.from).toBe(5);
    const alias = result.options[1];
    (alias.apply as Function)(view, alias, result.from, 7);
    expect(view.state.doc.toString()).toBe('Hi [[Ben|Benny]]');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(source(new CompletionContext(EditorState.create({ doc: '![[Be' }), 5, true))).toBeNull();
    view.destroy();
  });

  it('stays editable with unusual Markdown', () => {
    const errors = spyOn(console, 'error').and.callThrough();
    const docs = [
      '[[[Ben]]](https://x)', '[multi\nline](\nhttps://x)', '#\n##\n> \n>', '- [ ] task\n- [x] done\n* star\n+ plus',
      '```\n[[Ben]]\n```', '`[[Ben]]`', '[[Ben|]] [[|x]] [[ ]]', 'Title\n=====\n\nSub\n---', '***bold italic*** ~~strike~~ __u__',
      '<div>[[Ben]]</div>', '[ref]: https://x\n[ref]', '![[embed.png]] ![img](a.png)', '| a | b |\n|---|---|\n| [[Ben]] | 2 |',
    ];
    const { view, host, fixture } = setup();
    for (const doc of docs) {
      host.control.setValue(doc);
      fixture.detectChanges();
      for (let pos = 0; pos <= view.state.doc.length; pos++) {
        view.dispatch({ selection: { anchor: pos } });
      }
      view.contentDOM.blur();
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'Z' }, userEvent: 'input' });
      expect(host.control.value).toBe(doc + 'Z');
    }
    expect(errors).not.toHaveBeenCalled();
  });
});
