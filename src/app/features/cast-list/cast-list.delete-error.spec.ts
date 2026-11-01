import { CastListComponent } from './cast-list.component';
import { Cast } from '../../core/interfaces';
import { TrashStagingError } from '../../core/trash/trash-record-id';

describe('CastListComponent delete error display', () => {
  let component: CastListComponent;
  let metadataService: jasmine.SpyObj<any>;
  let modalService: { confirm: jasmine.Spy };

  const cast = {
    id: 'cast-1',
    name: 'Court',
    characterIds: ['a'],
  } as Cast;

  beforeEach(() => {
    metadataService = jasmine.createSpyObj('MetadataService', ['removeCast']);
    modalService = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };

    component = Object.create(CastListComponent.prototype);
    Object.assign(component, {
      toasts: jasmine.createSpyObj('NotificationService', ['showError']),
      metadataService,
      modalService,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
    });
  });

  it('toasts an ordinary delete failure', async () => {
    metadataService.removeCast.and.rejectWith(
      new Error('Failed to delete cast: no project loaded')
    );
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;

    await component.deleteCast(cast, event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect((component as any).toasts.showError).toHaveBeenCalledOnceWith('Failed to delete cast: no project loaded');
  });

  it('does not toast again for TrashStagingError (service already toasted)', async () => {
    metadataService.removeCast.and.rejectWith(new TrashStagingError('already toasted'));
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;

    await component.deleteCast(cast, event);

    expect((component as any).toasts.showError).not.toHaveBeenCalled();
  });
});
