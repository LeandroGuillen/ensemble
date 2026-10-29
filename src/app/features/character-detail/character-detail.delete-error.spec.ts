import { CharacterDetailComponent } from './character-detail.component';
import { TrashStagingError } from '../../core/trash/trash-record-id';

describe('CharacterDetailComponent delete error display', () => {
  let component: CharacterDetailComponent;
  let characterService: jasmine.SpyObj<any>;
  let notification: jasmine.SpyObj<any>;
  let modalService: { confirm: jasmine.Spy };
  let router: jasmine.SpyObj<any>;

  beforeEach(() => {
    characterService = jasmine.createSpyObj('CharacterService', [
      'deleteCharacter',
      'countCharacterReferences',
    ]);
    characterService.countCharacterReferences.and.resolveTo({
      houses: [],
      casts: [],
      pinboards: [],
      plotBoards: [],
    });
    notification = jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError']);
    modalService = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    router = jasmine.createSpyObj('Router', ['navigate']);

    component = Object.create(CharacterDetailComponent.prototype);
    Object.assign(component, {
      character: { id: 'ada', name: 'Ada' },
      isEditing: true,
      isDraftMode: false,
      isLoreMode: false,
      characterService,
      notificationService: notification,
      modalService,
      router,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
      cdr: jasmine.createSpyObj('ChangeDetectorRef', ['markForCheck']),
    });
  });

  it('shows a toast for an ordinary delete failure', async () => {
    characterService.deleteCharacter.and.rejectWith(new Error('no project loaded'));

    await component.deleteCharacter();

    expect(notification.showError).toHaveBeenCalledTimes(1);
    expect(notification.showError).toHaveBeenCalledWith(
      'Failed to delete character: Error: no project loaded'
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not toast again for TrashStagingError (service already toasted)', async () => {
    characterService.deleteCharacter.and.rejectWith(new TrashStagingError('already toasted'));

    await component.deleteCharacter();

    expect(notification.showError).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
