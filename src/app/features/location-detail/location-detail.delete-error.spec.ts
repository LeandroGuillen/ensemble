import { LocationDetailComponent } from './location-detail.component';
import { TrashStagingError } from '../../core/trash/trash-record-id';

describe('LocationDetailComponent delete error display', () => {
  let component: LocationDetailComponent;
  let locationService: jasmine.SpyObj<any>;
  let modalService: { confirm: jasmine.Spy };
  let router: jasmine.SpyObj<any>;

  beforeEach(() => {
    locationService = jasmine.createSpyObj('LocationService', ['deleteLocation']);
    modalService = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    router = jasmine.createSpyObj('Router', ['navigate']);

    component = Object.create(LocationDetailComponent.prototype);
    Object.assign(component, {
      location: { id: 'loc-1', name: 'Harbour' },
      error: null,
      locationService,
      modalService,
      router,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
    });
  });

  it('sets error for an ordinary delete failure', async () => {
    locationService.deleteLocation.and.rejectWith(
      new Error('Failed to delete location: no project loaded')
    );

    await component.deleteLocation();

    expect(component.error).toBe('Failed to delete location: no project loaded');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not set error for TrashStagingError (service already toasted)', async () => {
    locationService.deleteLocation.and.rejectWith(new TrashStagingError('already toasted'));

    await component.deleteLocation();

    expect(component.error).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
