import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { LocationDetailComponent } from './location-detail.component';
import { Location } from '../../core/interfaces/location.interface';
import {
  LocationService,
  ProjectService,
  MetadataService,
  NotificationService,
  ModalService,
  ImagePickerService,
  ElectronService,
} from '../../core/services';

function location(): Location {
  return {
    id: 'grey-harbor',
    name: 'Grey Harbor',
    content: 'A coastal city',
    books: [],
    thumbnail: '',
    filePath: '/project/locations/_grey-harbor.md',
    relativePath: '_grey-harbor.md',
    created: new Date(),
    modified: new Date(),
  };
}

describe('LocationDetailComponent - unsaved changes guards', () => {
  let component: LocationDetailComponent;
  let fixture: ComponentFixture<LocationDetailComponent>;
  let locations$: BehaviorSubject<Location[]>;
  let service: jasmine.SpyObj<LocationService>;
  let imagePicker: jasmine.SpyObj<ImagePickerService>;

  beforeEach(async () => {
    locations$ = new BehaviorSubject([location()]);
    imagePicker = jasmine.createSpyObj('ImagePickerService', ['handleNavigationAway'], {
      state$: of({ isOpen: false }),
    });
    imagePicker.handleNavigationAway.and.returnValue(true);

    service = jasmine.createSpyObj('LocationService', ['loadLocations', 'updateLocation', 'createLocation'], {
      locations$: locations$.asObservable(),
    });
    service.loadLocations.and.resolveTo();
    service.updateLocation.and.resolveTo(location());

    await TestBed.configureTestingModule({
      imports: [LocationDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'grey-harbor' })),
            snapshot: { paramMap: convertToParamMap({ id: 'grey-harbor' }) },
          },
        },
        { provide: LocationService, useValue: service },
        { provide: ImagePickerService, useValue: imagePicker },
        { provide: ProjectService, useValue: { currentProject$: of({ metadata: { books: [] } }), getCurrentProject: () => ({ path: '/project' }) } },
        { provide: MetadataService, useValue: { metadata$: of({ categories: [], tags: [] }) } },
        { provide: NotificationService, useValue: { showSuccess: jasmine.createSpy(), showError: jasmine.createSpy() } },
        { provide: ModalService, useValue: { confirm: jasmine.createSpy().and.resolveTo(true) } },
        { provide: ElectronService, useValue: { onBrowserNavigationCommand: () => undefined, removeBrowserNavigationCommandListener: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LocationDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('allows navigation when form is clean', () => {
    expect(component.locationForm.dirty).toBeFalse();
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts and respects user answer when form is dirty', () => {
    component.locationForm.markAsDirty();
    spyOn(window, 'confirm').and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    expect(window.confirm).toHaveBeenCalledWith('Discard your unsaved Location changes?');

    (window.confirm as jasmine.Spy).and.returnValue(true);
    expect(component.canLeave()).toBeTrue();
  });

  it('blocks navigation when image picker is open', () => {
    imagePicker.handleNavigationAway.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
  });

  it('blocks navigation when saving', () => {
    component.isSaving = true;
    expect(component.canLeave()).toBeFalse();
  });

  it('allows navigation after successful save', async () => {
    component.locationForm.markAsDirty();
    await component.saveLocation();
    expect(component.locationForm.dirty).toBeFalse();
    expect(component.canLeave()).toBeTrue();
  });

  it('prevents window close when form is dirty', () => {
    component.locationForm.markAsDirty();
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    spyOn(event, 'preventDefault');
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows window close when form is clean', () => {
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    spyOn(event, 'preventDefault');
    component.beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
