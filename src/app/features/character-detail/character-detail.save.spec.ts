import { FormBuilder } from '@angular/forms';
import { CharacterDetailComponent } from './character-detail.component';

describe('Character detail save', () => {
  let component: CharacterDetailComponent;
  let characterService: jasmine.SpyObj<any>;
  let notification: jasmine.SpyObj<any>;
  let router: jasmine.SpyObj<any>;

  beforeEach(() => {
    component = Object.create(CharacterDetailComponent.prototype);
    characterService = jasmine.createSpyObj('CharacterService', ['updateCharacter', 'saveBookPage', 'promoteDraft', 'createDraft']);
    notification = jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    Object.assign(component, {
      character: { id: 'ada', books: ['b1'] },
      characterForm: new FormBuilder().group({
        name: ['Ada'], category: ['person'], tags: [[]], books: [['b1']], content: ['General notes'],
      }),
      currentProject: {},
      isEditing: true,
      isDraftMode: false,
      bookPageData: { b1: { exists: true, content: 'New book notes' } },
      bookPageOriginalContent: { b1: 'Old book notes' },
      externalMainConflict: false,
      externalBookConflicts: new Set<string>(),
      aliases: [],
      aliasDraft: '',
      bookCategoriesMap: {},
      bookTagsMap: {},
      bookThumbnailsMap: {},
      thumbnailsMap: {},
      prompts: [],
      characterService,
      notificationService: notification,
      router,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
      cdr: jasmine.createSpyObj('ChangeDetectorRef', ['markForCheck']),
    });
    characterService.updateCharacter.and.resolveTo(component.character);
    characterService.saveBookPage.and.resolveTo();
  });

  it('allows a name-only Lore figure and requires category again when converted', () => {
    Object.assign(component, { fb: new FormBuilder(), isLoreMode: true });
    component.characterForm = (component as any).createForm();
    component.characterForm.patchValue({ name: 'Founder' });
    expect(component.characterForm.valid).toBeTrue();
    component.setLoreMode(false);
    expect(component.characterForm.valid).toBeFalse();
    component.characterForm.patchValue({ category: 'person' });
    expect((component as any).buildFormData().lore).toBeFalse();
    component.setLoreMode(true);
    expect((component as any).buildFormData().lore).toBeTrue();
    component.characterForm.patchValue({ name: '' });
    expect(component.characterForm.valid).toBeFalse();
  });

  it('saves a changed book description when saving from General', async () => {
    component.activeContentTab = 'main';
    component.characterForm.patchValue({ content: 'Updated general notes' });

    await component.onSubmit();

    expect(characterService.updateCharacter).toHaveBeenCalled();
    expect(characterService.saveBookPage).toHaveBeenCalledOnceWith('ada', 'b1', 'New book notes');
    expect(component.bookPageOriginalContent['b1']).toBe('New book notes');
    expect(notification.showSuccess).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalled();
  });

  it('keeps unsaved book content and stays on the editor if writing it fails', async () => {
    characterService.saveBookPage.and.rejectWith(new Error('Disk write failed'));

    await component.onSubmit();

    expect(component.bookPageOriginalContent['b1']).toBe('Old book notes');
    expect(notification.showError).toHaveBeenCalled();
    expect(notification.showSuccess).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not overwrite a book page with an external edit conflict', async () => {
    component.externalBookConflicts.add('b1');

    await component.onSubmit();

    expect(characterService.updateCharacter).not.toHaveBeenCalled();
    expect(characterService.saveBookPage).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it('converts to Lore without a category and saves edited book notes before moving', async () => {
    component.isDraftMode = true;
    component.characterForm.patchValue({ category: '' });
    characterService.promoteDraft.and.resolveTo({ id: 'ada', name: 'Ada', lore: true });
    await component.convertDraft('lore');

    expect(characterService.saveBookPage).toHaveBeenCalledOnceWith('ada', 'b1', 'New book notes');
    expect(characterService.promoteDraft).toHaveBeenCalledOnceWith('ada', 'lore');
    expect(characterService.saveBookPage).toHaveBeenCalledBefore(characterService.promoteDraft);
    expect(router.navigate.calls.allArgs()).toEqual([
      [['/characters'], { queryParams: { lore: 'true' }, replaceUrl: true }],
      [['/character', 'ada']],
    ]);
    expect(component.characterForm.pristine).toBeTrue();
  });

  it('requires a category to convert a draft to Characters', async () => {
    component.isDraftMode = true;
    component.characterForm.patchValue({ category: '' });
    await component.convertDraft('characters');
    expect(notification.showError).toHaveBeenCalled();
    expect(characterService.updateCharacter).not.toHaveBeenCalled();
    expect(characterService.promoteDraft).not.toHaveBeenCalled();
  });

  it('keeps a draft open when an edited book page has an external conflict', async () => {
    component.isDraftMode = true;
    component.externalBookConflicts.add('b1');
    await component.convertDraft('lore');
    expect(characterService.promoteDraft).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notification.showError).toHaveBeenCalled();
  });

  it('keeps a newly saved draft for retry when conversion fails', async () => {
    component.isDraftMode = true;
    component.isEditing = false;
    component.character = null;
    characterService.createDraft.and.resolveTo({ id: 'new-draft', name: 'Ada' });
    characterService.promoteDraft.and.rejectWith(new Error('Move failed'));
    await component.convertDraft('lore');
    expect((component.character as any)?.id).toBe('new-draft');
    expect(component.isEditing).toBeTrue();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(notification.showError).toHaveBeenCalled();
  });

  it('replaces the draft editor with Characters in history before opening the converted record', async () => {
    component.isDraftMode = true;
    characterService.promoteDraft.and.resolveTo({ id: 'ada', name: 'Ada' });
    await component.convertDraft('characters');
    expect(router.navigate.calls.allArgs()).toEqual([
      [['/characters'], { queryParams: undefined, replaceUrl: true }],
      [['/character', 'ada']],
    ]);
  });

  it('replaces the old editor history entry when moving a Character to Lore', async () => {
    component.isLoreMode = true;
    await component.onSubmit();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/characters'], {
      queryParams: { lore: 'true' }, replaceUrl: true,
    });
  });

  it('replaces the old editor history entry when moving Lore back to Characters', async () => {
    component.character = { ...component.character, lore: true } as any;
    component.isLoreMode = false;
    await component.onSubmit();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/characters'], {
      queryParams: undefined, replaceUrl: true,
    });
  });

});
