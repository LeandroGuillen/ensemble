import { FormBuilder } from '@angular/forms';
import { CharacterDetailComponent } from './character-detail.component';

describe('Character detail external edits', () => {
  let component: CharacterDetailComponent;
  let notification: jasmine.SpyObj<any>;
  let characterService: jasmine.SpyObj<any>;

  beforeEach(() => {
    component = Object.create(CharacterDetailComponent.prototype);
    notification = jasmine.createSpyObj('NotificationService', ['showWarning', 'showError']);
    characterService = jasmine.createSpyObj('CharacterService', [
      'getBookPageFilePath', 'getBookPageContent', 'updateCharacter'
    ]);
    Object.assign(component, {
      character: { id: 'ada', filePath: '/project/characters/ada/ada.md', books: ['b1'] },
      characterForm: new FormBuilder().group({ name: ['Ada'] }),
      bookPageData: { b1: { exists: true, content: 'old' } },
      bookPageOriginalContent: { b1: 'old' },
      externalMainConflict: false,
      externalBookConflicts: new Set<string>(),
      activeContentTab: 'main',
      notificationService: notification,
      characterService,
      cdr: jasmine.createSpyObj('ChangeDetectorRef', ['markForCheck']),
    });
    characterService.getBookPageFilePath.and.returnValue('/project/characters/ada/ada.b1.md');
  });

  it('keeps unsaved form edits and blocks saving after an external main-file change', async () => {
    component.characterForm.markAsDirty();
    const reload = spyOn(component as any, 'loadCharacter').and.resolveTo();

    await (component as any).handleExternalFileChange({
      type: 'change', path: '/project/characters/ada/ada.md'
    });
    await component.onSubmit();

    expect(component.externalMainConflict).toBeTrue();
    expect(reload).not.toHaveBeenCalled();
    expect(characterService.updateCharacter).not.toHaveBeenCalled();
    expect(notification.showError).toHaveBeenCalled();
  });

  it('refreshes a clean book page when its Markdown file changes', async () => {
    characterService.getBookPageContent.and.resolveTo('from Obsidian');

    await (component as any).handleExternalFileChange({
      type: 'change', path: '/project/characters/ada/ada.b1.md'
    });

    expect(component.bookPageData['b1'].content).toBe('from Obsidian');
    expect(component.bookPageOriginalContent['b1']).toBe('from Obsidian');
  });

  it('keeps unsaved book-page content when the same file changes externally', async () => {
    component.bookPageData['b1'].content = 'mine';

    await (component as any).handleExternalFileChange({
      type: 'change', path: '/project/characters/ada/ada.b1.md'
    });

    expect(component.bookPageData['b1'].content).toBe('mine');
    expect(component.externalBookConflicts.has('b1')).toBeTrue();
    expect(characterService.getBookPageContent).not.toHaveBeenCalled();
  });
});
