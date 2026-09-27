import { FormBuilder } from '@angular/forms';
import { CharacterDetailComponent } from './character-detail.component';

describe('Character detail save', () => {
  let component: CharacterDetailComponent;
  let characterService: jasmine.SpyObj<any>;
  let notification: jasmine.SpyObj<any>;
  let router: jasmine.SpyObj<any>;

  beforeEach(() => {
    component = Object.create(CharacterDetailComponent.prototype);
    characterService = jasmine.createSpyObj('CharacterService', ['updateCharacter', 'saveBookPage']);
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
});
