import { BookPlanComponent } from './book-plan.component';
import { parseBookPlan } from '../../core/utils/book-plan.utils';
import { buildWikiLinkTargets } from '../../core/utils/wiki-links.utils';

describe('Book plan character linking', () => {
  let component: BookPlanComponent;
  let editor: { applyUndoableChanges: jasmine.Spy; focus: jasmine.Spy };
  let notifications: { showWarning: jasmine.Spy };

  beforeEach(() => {
    component = Object.create(BookPlanComponent.prototype);
    const characters = [{ id: 'b', name: 'Ben', aliases: ['Benny'], relativePath: 'ben/ben.md' }];
    const targets = buildWikiLinkTargets([{ targets: characters, folder: 'characters', route: 'character', singular: 'Character' }]);
    component.bookId = 'book1';
    component.characters = characters;
    component.linkSuggestions = targets.suggestions;
    component.linkResolver = targets.resolve;
    component.state = { bookId: 'book1', relativePath: 'one.plan.md', text: 'Ben meets Benny.', parsed: parseBookPlan('Ben meets Benny.'), drafts: {}, dirty: false, conflict: null, revision: 1, error: null };
    editor = { applyUndoableChanges: jasmine.createSpy('applyUndoableChanges'), focus: jasmine.createSpy('focus') };
    component.editor = editor as any;
    notifications = { showWarning: jasmine.createSpy('showWarning') };
    (component as any).notifications = notifications;
  });

  it('previews only the current book without editing, and cancel discards it', () => {
    component.previewCharacterLinks();
    expect(component.linkPreview?.count).toBe(2);
    expect(component.state?.text).toBe('Ben meets Benny.');
    expect(editor.applyUndoableChanges).not.toHaveBeenCalled();
    component.linkPreview = null;
    component.confirmCharacterLinks();
    expect(editor.applyUndoableChanges).not.toHaveBeenCalled();
    component.state!.bookId = 'another-book';
    component.previewCharacterLinks();
    expect(component.linkPreview).toBeNull();
  });

  it('writes only on confirmation and keeps the report outside the plan', () => {
    component.previewCharacterLinks();
    component.confirmCharacterLinks();
    expect(editor.applyUndoableChanges).toHaveBeenCalledOnceWith([{ from: 0, to: 3, insert: '[[Ben]]' }, { from: 10, to: 15, insert: '[[Ben|Benny]]' }]);
    expect(component.linkPreview).toBeNull();
    expect(component.linkReport?.count).toBe(2);
  });

  for (const change of ['text', 'book', 'path', 'revision', 'conflict', 'error', 'characters']) {
    it(`refuses confirmation after ${change} changes`, () => {
      component.previewCharacterLinks();
      switch (change) {
        case 'text': component.state!.text = 'Edited'; break;
        case 'book': component.state!.bookId = 'book2'; break;
        case 'path': component.state!.relativePath = 'two.plan.md'; break;
        case 'revision': component.state!.revision++; break;
        case 'conflict': component.state!.conflict = 'external'; break;
        case 'error': component.state!.error = 'read error'; break;
        case 'characters': component.linkSuggestions = []; break;
      }
      component.confirmCharacterLinks();
      expect(editor.applyUndoableChanges).not.toHaveBeenCalled();
      expect(notifications.showWarning).toHaveBeenCalled();
      expect(component.linkPreview).toBeNull();
    });
  }

  it('jumps to a report line in the plan editor', () => {
    const jump = spyOn(component, 'jumpToLine');
    component.jumpToLinkMention(42);
    expect(jump).toHaveBeenCalledWith(42);
    expect(editor.focus).toHaveBeenCalled();
  });
});
