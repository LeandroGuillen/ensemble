import { CastDetailComponent } from './cast-detail.component';
import { TrashStagingError } from '../../core/trash/trash-record-id';

describe('CastDetailComponent delete error display', () => {
  let component: CastDetailComponent;
  let metadataService: jasmine.SpyObj<any>;
  let modalService: { confirm: jasmine.Spy };
  let router: jasmine.SpyObj<any>;

  beforeEach(() => {
    metadataService = jasmine.createSpyObj('MetadataService', ['removeCast']);
    modalService = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    router = jasmine.createSpyObj('Router', ['navigate']);

    component = Object.create(CastDetailComponent.prototype);
    Object.assign(component, {
      cast: { id: 'cast-1', name: 'Court' },
      error: null as string | null,
      metadataService,
      modalService,
      router,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
    });
  });

  it('sets error for an ordinary delete failure', async () => {
    metadataService.removeCast.and.rejectWith(new Error('no project loaded'));

    await component.deleteCast();

    expect(component.error).toBe('Failed to delete cast: Error: no project loaded');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not set error for TrashStagingError (service already toasted)', async () => {
    metadataService.removeCast.and.rejectWith(new TrashStagingError('already toasted'));

    await component.deleteCast();

    expect(component.error).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
