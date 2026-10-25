import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { CharacterDetailComponent } from './character-detail.component';
import { Character } from '../../core/interfaces';
import {
  CharacterService,
  ProjectService,
  MetadataService,
  NotificationService,
  ModalService,
  ImagePickerService,
  ElectronService,
  AiService,
  ImageGenerationService,
  HouseService,
  LocationService,
  FileWatcherService,
  LoggingService,
  MetadataHelperService,
} from '../../core/services';

function character(): Character {
  return {
    id: 'ned',
    name: 'Eddard Stark',
    aliases: [],
    category: 'main-character',
    tags: [],
    books: [],
    thumbnails: {},
    prompts: [],
    content: 'Lord of Winterfell',
    filePath: '/project/characters/ned/ned.md',
    relativePath: 'ned/ned.md',
    created: new Date(),
    modified: new Date(),
  };
}

describe('CharacterDetailComponent unsaved changes guards', () => {
  let component: CharacterDetailComponent;
  let fixture: ComponentFixture<CharacterDetailComponent>;
  let characters$: BehaviorSubject<Character[]>;
  let characterService: jasmine.SpyObj<CharacterService>;
  let imagePickerService: jasmine.SpyObj<ImagePickerService>;

  beforeEach(async () => {
    characters$ = new BehaviorSubject([character()]);
    characterService = jasmine.createSpyObj(
      'CharacterService',
      ['loadCharacters', 'loadThumbnailsForCharacters', 'getReferenceCharacters', 'updateCharacter', 'createCharacter', 'getCachedThumbnail'],
      { characters$: characters$.asObservable() }
    );
    characterService.loadCharacters.and.resolveTo();
    characterService.loadThumbnailsForCharacters.and.resolveTo();
    characterService.getReferenceCharacters.and.returnValue(of([]));
    characterService.updateCharacter.and.resolveTo(character());
    characterService.getCachedThumbnail.and.returnValue(null);

    imagePickerService = jasmine.createSpyObj('ImagePickerService', ['handleNavigationAway', 'close'], {
      state$: of({ isOpen: false }),
    });
    imagePickerService.handleNavigationAway.and.returnValue(true);
    imagePickerService.close.and.returnValue(undefined);

    await TestBed.configureTestingModule({
      imports: [CharacterDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'ned' })),
            snapshot: { paramMap: convertToParamMap({ id: 'ned' }), data: {} },
          },
        },
        { provide: CharacterService, useValue: characterService },
        { provide: ImagePickerService, useValue: imagePickerService },
        {
          provide: ProjectService,
          useValue: {
            currentProject$: of({ metadata: { books: [], settings: { characterStyles: [{ id: 'default', name: 'Default' }], defaultCharacterStyle: 'default' } } }),
            getCurrentProject: () => ({ path: '/project' }),
            getCategories: () => [],
            getTags: () => [],
            getCharacterStyles: () => [{ id: 'default', name: 'Default' }],
            getDefaultCharacterStyle: () => 'default',
            getLastCharacterListStyle: () => null,
          },
        },
        { provide: MetadataService, useValue: { metadata$: of({ categories: [{ id: 'main-character', name: 'Main Character', color: '#ffffff' }], tags: [] }), getBooks: () => [] } },
        { provide: NotificationService, useValue: { showSuccess: jasmine.createSpy(), showError: jasmine.createSpy() } },
        { provide: ModalService, useValue: { confirm: jasmine.createSpy().and.resolveTo(true) } },
        { provide: ElectronService, useValue: { onBrowserNavigationCommand: () => undefined, removeBrowserNavigationCommandListener: () => undefined, setBrowserNavigationInterception: () => undefined } },
        { provide: AiService, useValue: { getAiSettings: () => of({ enabled: false }) } },
        { provide: ImageGenerationService, useValue: { listWorkflows: () => Promise.resolve([]), getDefaultWorkflowId: () => null } },
        { provide: HouseService, useValue: { houses$: of([]), loadHouses: () => Promise.resolve() } },
        { provide: LocationService, useValue: { locations$: of([]), getLocations: () => of([]), loadLocations: () => Promise.resolve() } },
        { provide: FileWatcherService, useValue: { fileChanges$: of(null) } },
        { provide: LoggingService, useValue: { log: jasmine.createSpy(), error: jasmine.createSpy() } },
        { provide: MetadataHelperService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CharacterDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('allows navigation when form is clean and no book pages are dirty', () => {
    expect(component.characterForm.dirty).toBeFalse();
    expect(component.hasAnyBookPageDirty()).toBeFalse();
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts and respects user answer when main form is dirty', () => {
    component.characterForm.markAsDirty();
    spyOn(window, 'confirm').and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    expect(window.confirm).toHaveBeenCalledWith('Discard your unsaved Character changes?');

    (window.confirm as jasmine.Spy).and.returnValue(true);
    expect(component.canLeave()).toBeTrue();
  });

  it('prompts when any book page is dirty', () => {
    spyOn(component, 'hasAnyBookPageDirty').and.returnValue(true);
    spyOn(window, 'confirm').and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    expect(window.confirm).toHaveBeenCalledWith('Discard your unsaved Character changes?');
  });

  it('blocks navigation when image picker is open', () => {
    imagePickerService.handleNavigationAway.and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
  });

  it('blocks navigation when saving', () => {
    component.isSaving = true;
    expect(component.canLeave()).toBeFalse();
  });

  it('allows navigation after successful save', async () => {
    component.characterForm.markAsDirty();
    await component.onSubmit();
    expect(component.characterForm.dirty).toBeFalse();
    expect(component.canLeave()).toBeTrue();
  });

  it('prevents window close when main form is dirty', () => {
    component.characterForm.markAsDirty();
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    spyOn(event, 'preventDefault');
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('prevents window close when any book page is dirty', () => {
    spyOn(component, 'hasAnyBookPageDirty').and.returnValue(true);
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    spyOn(event, 'preventDefault');
    component.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('allows window close when form is clean and no book pages are dirty', () => {
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    spyOn(event, 'preventDefault');
    component.beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
