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
      error: null as string | null,
      metadataService,
      modalService,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
    });
  });

  it('sets error for an ordinary delete failure', async () => {
    metadataService.removeCast.and.rejectWith(
      new Error('Failed to delete cast: no project loaded')
    );
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;

    await component.deleteCast(cast, event);

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.error).toBe('Failed to delete cast: no project loaded');
  });

  it('does not set error for TrashStagingError (service already toasted)', async () => {
    metadataService.removeCast.and.rejectWith(new TrashStagingError('already toasted'));
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as any;

    await component.deleteCast(cast, event);

    expect(component.error).toBeNull();
  });
});
