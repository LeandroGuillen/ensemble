import { CharacterListComponent } from './character-list.component';
import { Character } from '../../core/interfaces';
import { TrashStagingError } from '../../core/trash/trash-record-id';

describe('CharacterListComponent delete error display', () => {
  let component: CharacterListComponent;
  let characterService: jasmine.SpyObj<any>;
  let notification: jasmine.SpyObj<any>;
  let modalService: { confirm: jasmine.Spy };

  const character = {
    id: 'ada',
    name: 'Ada',
    category: 'main',
    tags: [],
    books: [],
    prompts: [],
    content: '',
    created: new Date(),
    modified: new Date(),
    relativePath: 'ada/ada.md',
    filePath: '/project/characters/ada/ada.md',
  } as Character;

  beforeEach(() => {
    characterService = jasmine.createSpyObj('CharacterService', ['deleteCharacter']);
    notification = jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError']);
    modalService = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };

    component = Object.create(CharacterListComponent.prototype);
    Object.assign(component, {
      characterService,
      notificationService: notification,
      modalService,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
    });
  });

  it('toasts an ordinary delete failure', async () => {
    characterService.deleteCharacter.and.rejectWith(
      new Error('Failed to delete character: no project loaded')
    );
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;

    await component.deleteCharacter(character, event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(notification.showError).toHaveBeenCalledTimes(1);
    expect(notification.showError).toHaveBeenCalledWith(
      'Failed to delete character: no project loaded'
    );
  });

  it('does not toast again for TrashStagingError (service already toasted)', async () => {
    characterService.deleteCharacter.and.rejectWith(new TrashStagingError('already toasted'));
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;

    await component.deleteCharacter(character, event);

    expect(notification.showError).not.toHaveBeenCalled();
  });
});
