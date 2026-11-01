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
      toasts: jasmine.createSpyObj('NotificationService', ['showError']),
      locationService,
      modalService,
      router,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
    });
  });

  it('toasts an ordinary delete failure', async () => {
    locationService.deleteLocation.and.rejectWith(
      new Error('Failed to delete location: no project loaded')
    );

    await component.deleteLocation();

    expect((component as any).toasts.showError).toHaveBeenCalledOnceWith('Failed to delete location: no project loaded');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not toast again for TrashStagingError (service already toasted)', async () => {
    locationService.deleteLocation.and.rejectWith(new TrashStagingError('already toasted'));

    await component.deleteLocation();

    expect((component as any).toasts.showError).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
