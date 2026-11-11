import { Directive, forwardRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BookEditActionsService } from '../../core/services/book-edit-actions.service';
import { BookPlanService } from '../../core/services/book-plan.service';
import { CharacterPickerService } from '../../core/services/character-picker.service';
import { CharacterService } from '../../core/services/character.service';
import { ElectronService } from '../../core/services/electron.service';
import { LoggingService } from '../../core/services/logging.service';
import { MetadataService } from '../../core/services/metadata.service';
import { NotificationService } from '../../core/services/notification.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { ProjectService } from '../../core/services/project.service';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';
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

  for (const selected of [false, true]) {
    it(`links a first-name suggestion only when checked (selected: ${selected})`, () => {
      const characters = [{ id: 'm', name: 'Mara Vell', relativePath: 'mara/mara.md' }];
      const targets = buildWikiLinkTargets([{ targets: characters, folder: 'characters', route: 'character', singular: 'Character' }]);
      component.characters = characters;
      component.linkSuggestions = targets.suggestions;
      component.linkResolver = targets.resolve;
      component.state!.text = 'Mara meets Mara Vell.';
      component.previewCharacterLinks();
      const suggestion = component.linkPreview!.ambiguous[0];
      expect(suggestion.selected).toBeFalse();
      expect(component.characterLinkCount).toBe(1);
      suggestion.selected = selected;
      expect(component.characterLinkCount).toBe(selected ? 2 : 1);
      component.confirmCharacterLinks();
      const full = { from: 11, to: 20, insert: '[[Mara Vell]]' };
      expect(editor.applyUndoableChanges).toHaveBeenCalledOnceWith(selected
        ? [{ from: 0, to: 4, insert: '[[Mara Vell|Mara]]' }, full] : [full]);
      expect(component.linkReport!.text).toBe(selected ? '[[Mara Vell|Mara]] meets [[Mara Vell]].' : 'Mara meets [[Mara Vell]].');
      expect(component.linkReport!.ambiguous.length).toBe(selected ? 0 : 1);
    });
  }

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

@Directive({
  selector: 'app-markdown-editor',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => StubPlanEditor), multi: true }],
})
class StubPlanEditor implements ControlValueAccessor {
  writeValue(): void {}
  registerOnChange(): void {}
  registerOnTouched(): void {}
}

// Render the production template while isolating unrelated page services and child editors.
describe('Book plan character linking text', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BookPlanComponent],
      providers: [
        ...[ActivatedRoute, Router, BookEditActionsService, BookPlanService,
          CharacterPickerService, CharacterService, ElectronService, LoggingService,
          MetadataService, NotificationService, ProjectService, WikiLinkTargetsService,
          CommandPaletteService].map(provide => ({ provide, useValue: {} })),
        { provide: PreferencesService, useValue: { getPlanOutlineSide: () => 'left' } },
      ],
    });
    TestBed.overrideComponent(BookPlanComponent, {
      set: { imports: [FormsModule, StubPlanEditor], schemas: [NO_ERRORS_SCHEMA] },
    });
    spyOn(BookPlanComponent.prototype, 'ngOnInit');
    spyOn(BookPlanComponent.prototype, 'ngOnDestroy');
  });

  for (const count of [0, 1, 2]) {
    it(`renders preview, confirmation and report grammar for ${count} links and review mentions`, async () => {
      const fixture = TestBed.createComponent(BookPlanComponent);
      const component = fixture.componentInstance;
      const scan = { text: '', count: 0, changes: [], ambiguous: Array.from({ length: 2 }, (_, index) => ({
        chapter: 'Chapter', line: index, text: 'Mara', mention: 'Mara',
        candidates: ['Mara Vell'], reason: 'Shortened name', selected: false,
        change: { from: index, to: index + 1, insert: '[[Mara Vell|Mara]]' },
      })) };
      component.book = { id: 'book1', title: 'Book' } as any;
      component.state = { bookId: 'book1', relativePath: 'one.plan.md', text: '',
        parsed: parseBookPlan(''), drafts: {}, dirty: false, conflict: null, revision: 1, error: null };
      component.linkPreview = { ...scan, source: '', bookId: 'book1', path: 'one.plan.md',
        revision: 1, suggestions: [] };
      fixture.detectChanges();
      await fixture.whenStable();
      const root: HTMLElement = fixture.nativeElement;
      // Reproduce ticking suggestions, so the text must follow the selected count.
      const checkboxes = root.querySelectorAll<HTMLInputElement>('.link-preview input');
      for (let index = 0; index < count; index++) checkboxes[index].click();
      fixture.detectChanges();
      const noun = count === 1 ? 'link' : 'links';
      expect(root.querySelector('.link-preview p')!.textContent).toContain(`${count} ${noun} will be added.`);
      expect(root.querySelector('.link-preview-actions .btn-primary')!.textContent!.trim()).toBe(`Confirm ${count} ${noun}`);

      component.linkPreview = null;
      component.linkReport = { ...scan, count, ambiguous: scan.ambiguous.slice(0, count) };
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      const review = count === 1 ? 'mention needs' : 'mentions need';
      expect(root.querySelector('.link-report-header strong')!.textContent!.trim())
        .toBe(`${count} ${noun} added · ${count} ${review} review`);
    });
  }
});
