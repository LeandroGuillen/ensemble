import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { MetadataManagementComponent } from './metadata-management.component';
import { Character } from '../../core/interfaces/character.interface';
import { MetadataService } from '../../core/services/metadata.service';
import { ProjectService } from '../../core/services/project.service';
import { ProjectIconService } from '../../core/services/project-icon.service';
import { CharacterService } from '../../core/services/character.service';
import { CastService } from '../../core/services/cast.service';
import { LocationService } from '../../core/services/location.service';
import { PromptService } from '../../core/services/prompt.service';
import { BackstageService } from '../../core/services/backstage.service';
import { ThemeService } from '../../core/services/theme.service';
import { SkinService } from '../../core/services/skin.service';
import { ColorPaletteService } from '../../core/services/color-palette.service';
import { UpdateService } from '../../core/services/update.service';
import { ElectronService } from '../../core/services/electron.service';
import { ZoomService } from '../../core/services/zoom.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { ModalService } from '../../core/services/modal.service';
import { LoggingService } from '../../core/services/logging.service';
import { NotificationService } from '../../core/services/notification.service';
import { SettingsSearchService } from '../settings/settings-search.service';
import { SETTINGS_FIELD_INDEX } from '../settings/settings-field-index';
import { PendingEditsService } from '../../core/services/pending-edits.service';

/** Delete confirmation for categories and tags: says how many characters use them. */
describe('MetadataManagementComponent delete confirmation', () => {
  const character = (overrides: Partial<Character>): Character =>
    ({ id: 'x', name: 'X', category: 'main-character', tags: [], books: [], ...overrides }) as Character;

  let component: MetadataManagementComponent;
  let metadataService: jasmine.SpyObj<{ removeCategory(id: string): Promise<void>; removeTag(id: string): Promise<void> }>;

  beforeEach(() => {
    jasmine.clock().install();
    metadataService = jasmine.createSpyObj('MetadataService', ['removeCategory', 'removeTag']);
    metadataService.removeCategory.and.resolveTo();
    metadataService.removeTag.and.resolveTo();
    // Only the delete-confirmation members are exercised, so skip the heavy constructor.
    component = Object.create(MetadataManagementComponent.prototype);
    Object.assign(component, {
      pendingDelete: null,
      pendingDeleteTimeout: null,
      saving: false,
      settings: { defaultCategory: 'main-character' },
      metadataService,
      logger: jasmine.createSpyObj('LoggingService', ['error']),
      characterService: {
        getReferenceCharactersSnapshot: () => [
          character({ id: 'ilse', bookCategories: { lc1: 'antagonist' }, bookTags: { lc2: ['tide-touched'] } }),
          character({ id: 'saffi', tags: ['tide-touched'] }),
          character({ id: 'olm', category: 'antagonist' }),
        ],
        getDraftsSnapshot: () => [character({ id: 'wren', bookTags: { lc1: ['tide-touched'] } })],
      },
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('says how many characters (per-book overrides and drafts included) use a tag before deleting it', async () => {
    const tag = { id: 'tide-touched', name: 'Tide Touched', color: '#0ff' };

    await component.deleteTag(tag);

    expect(metadataService.removeTag).not.toHaveBeenCalled();
    expect(component.deleteConfirmLabel('tag', tag.id)).toBe('Used by 3 characters. Delete?');

    await component.deleteTag(tag);
    expect(metadataService.removeTag).toHaveBeenCalledOnceWith('tide-touched');
  });

  it('says how many characters use a category, and when none do', async () => {
    const antagonist = { id: 'antagonist', name: 'Antagonist', color: '#000' };
    const mentor = { id: 'mentor', name: 'Mentor', color: '#111' };

    await component.deleteCategory(antagonist);
    expect(component.deleteConfirmLabel('category', antagonist.id)).toBe('Used by 2 characters. Delete?');

    await component.deleteCategory(mentor);
    expect(component.deleteConfirmLabel('category', mentor.id)).toBe('No characters use it. Delete?');
    expect(metadataService.removeCategory).not.toHaveBeenCalled();
  });
});

/**
 * Settings autosaves 600 ms after the last keystroke. Leaving Settings (destroy),
 * quitting / reloading or switching project inside that window must still save.
 */
describe('MetadataManagementComponent pending autosave on leave', () => {
  let fixture: ComponentFixture<MetadataManagementComponent>;
  let component: MetadataManagementComponent;
  let project: BehaviorSubject<any>;
  let metadataService: { metadata$: BehaviorSubject<any>; loadMetadata: jasmine.Spy; updateSettings: jasmine.Spy };
  let projectService: { currentProject$: BehaviorSubject<any>; getCurrentProject: jasmine.Spy; getCharacterStyles: jasmine.Spy; updateMetadata: jasmine.Spy };
  let promptService: { forceReload: jasmine.Spy };
  let logger: { error: jasmine.Spy; warn: jasmine.Spy };
  let toasts: { showError: jasmine.Spy };

  const settings = {
    defaultCategory: 'main-character',
    charactersFolder: 'characters',
    locationsFolder: 'locations',
    promptsFolder: 'prompts',
    castsFolder: 'characters/casts',
    namesFile: 'characters/names.md',
    imagesFolder: 'img',
    defaultCharacterStyle: 'default',
    theme: 'blue-gold',
    skin: 'classic',
  };

  beforeEach(async () => {
    project = new BehaviorSubject<any>({ path: '/tmp/p', metadata: { projectName: 'The Lantern Coast', settings } });
    metadataService = {
      metadata$: new BehaviorSubject<any>({ categories: [], tags: [], settings }),
      loadMetadata: jasmine.createSpy('loadMetadata').and.resolveTo(),
      updateSettings: jasmine.createSpy('updateSettings').and.resolveTo(),
    };
    projectService = {
      currentProject$: project,
      getCurrentProject: jasmine.createSpy('getCurrentProject').and.callFake(() => project.value),
      getCharacterStyles: jasmine.createSpy('getCharacterStyles').and.returnValue([{ id: 'default', name: 'Default' }]),
      updateMetadata: jasmine.createSpy('updateMetadata').and.callFake(async (updates: any) => {
        project.next({ ...project.value, metadata: { ...project.value.metadata, ...updates } });
      }),
    };
    promptService = { forceReload: jasmine.createSpy('forceReload').and.resolveTo() };
    logger = { error: jasmine.createSpy('error'), warn: jasmine.createSpy('warn') };
    toasts = { showError: jasmine.createSpy('showError') };

    await TestBed.configureTestingModule({
      imports: [MetadataManagementComponent],
      providers: [
        { provide: MetadataService, useValue: metadataService },
        { provide: ProjectService, useValue: projectService },
        { provide: ProjectIconService, useValue: { getIconPath: () => null, iconUrl$: of(null) } },
        { provide: CharacterService, useValue: { forceReloadCharacters: jasmine.createSpy().and.resolveTo() } },
        { provide: CastService, useValue: { forceReloadCasts: jasmine.createSpy().and.resolveTo() } },
        { provide: LocationService, useValue: { forceReloadLocations: jasmine.createSpy().and.resolveTo() } },
        { provide: PromptService, useValue: promptService },
        { provide: BackstageService, useValue: { loadBackstageData: jasmine.createSpy().and.resolveTo() } },
        { provide: ThemeService, useValue: { getAvailableThemes: () => [], currentTheme$: of(null), setTheme: jasmine.createSpy().and.resolveTo() } },
        { provide: SkinService, useValue: { getAvailableSkins: () => [], setSkin: jasmine.createSpy().and.resolveTo() } },
        { provide: ColorPaletteService, useValue: { palette$: of(null), getAllColors: () => [] } },
        { provide: UpdateService, useValue: { updateStatus$: of({ status: 'idle' }) } },
        { provide: ElectronService, useValue: { getVersion: () => Promise.resolve('0.0.0') } },
        { provide: ZoomService, useValue: { zoomLevel$: of(1), getZoomPercent: () => 100 } },
        { provide: PreferencesService, useValue: { getLocationDetailsSide: () => 'right', setLocationDetailsSide: () => undefined, getPlanOutlineSide: () => 'left', setPlanOutlineSide: () => undefined } },
        { provide: ModalService, useValue: {} },
        { provide: LoggingService, useValue: logger },
        { provide: NotificationService, useValue: toasts },
      ],
    })
      .compileComponents();

    fixture = TestBed.createComponent(MetadataManagementComponent);
    component = fixture.componentInstance;
    component.activeSection = 'categories';
    // The mocked metadata observable supplies the loaded state for these form tests.
    spyOn<any>(component, 'loadData').and.resolveTo();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  });

  it('adds categories without offering or saving folder settings', async () => {
    const addCategory = jasmine.createSpy('addCategory').and.resolveTo();
    Object.assign(metadataService, { addCategory });
    component.showAddCategoryForm();
    component.categoryForm.patchValue({ name: 'Hero', color: '#123456' });
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form');
    expect(form).not.toBeNull();
    expect(form.querySelector('[formControlName="folderMode"], [formControlName="folderPath"]')).toBeNull();
    expect(form.textContent).not.toContain('Folder Structure');
    await component.saveCategory();
    expect(addCategory).toHaveBeenCalledOnceWith({ name: 'Hero', color: '#123456', description: '' });
  });

  it('edits legacy categories without offering or overwriting folder settings', async () => {
    const updateCategory = jasmine.createSpy('updateCategory').and.resolveTo();
    Object.assign(metadataService, { updateCategory });
    const category = { id: 'hero', name: 'Hero', color: '#123456', folderMode: 'specify' as const, folderPath: 'heroes' };
    component.categories = [category];
    component.showEditCategoryForm(category);
    component.categoryForm.patchValue({ name: 'Heroes' });
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form');
    expect(form).not.toBeNull();
    expect(form.querySelector('[formControlName="folderMode"], [formControlName="folderPath"]')).toBeNull();
    expect(form.textContent).not.toContain('Folder:');
    await component.saveCategory();
    expect(updateCategory).toHaveBeenCalledOnceWith('hero', { name: 'Heroes', color: '#123456', description: '' });
  });

  it('does not match obsolete category folder terms in settings search', () => {
    const search = TestBed.inject(SettingsSearchService);
    const categoryField = SETTINGS_FIELD_INDEX.find(field => field.id === 'categories')!;
    for (const query of ['folder mode', 'auto', 'flat', 'custom folder']) {
      search.setQuery(query);
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      expect(search.matches(categoryField.label, ...categoryField.keywords)).withContext(query).toBeFalse();
      expect(fixture.nativeElement.querySelector('.categories-section').hidden).withContext(query).toBeTrue();
    }
    search.setQuery('categories');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.categories-section').hidden).toBeFalse();
  });

  it('saves a Project Name typed less than 600 ms before leaving Settings', fakeAsync(() => {
    component.projectNameControl.setValue('Renamed A (quick leave)');
    tick(200);
    fixture.destroy();
    flushMicrotasks();

    expect(projectService.updateMetadata).toHaveBeenCalledOnceWith({ projectName: 'Renamed A (quick leave)' });
    tick(1000);
    expect(projectService.updateMetadata).toHaveBeenCalledTimes(1);
  }));

  it('saves a Prompts Folder typed less than 600 ms before leaving Settings', fakeAsync(() => {
    component.settingsForm.patchValue({ promptsFolder: 'prompt-library' });
    tick(200);
    fixture.destroy();
    flushMicrotasks();

    expect(metadataService.updateSettings).toHaveBeenCalledTimes(1);
    expect(metadataService.updateSettings.calls.mostRecent().args[0].promptsFolder).toBe('prompt-library');
    expect(promptService.forceReload).toHaveBeenCalled();
    tick(1000);
    expect(metadataService.updateSettings).toHaveBeenCalledTimes(1);
  }));

  it('quit / reload / project switch (flushAll) saves edits still waiting on the debounce, once', fakeAsync(() => {
    const pendingEdits = TestBed.inject(PendingEditsService);
    component.projectNameControl.setValue('Renamed C (quit)');
    component.settingsForm.patchValue({ promptsFolder: 'prompt-library' });
    tick(200);

    let flushed = false;
    void pendingEdits.flushAll().then(() => (flushed = true));
    flushMicrotasks();

    expect(flushed).toBeTrue();
    expect(projectService.updateMetadata).toHaveBeenCalledOnceWith({ projectName: 'Renamed C (quit)' });
    expect(metadataService.updateSettings).toHaveBeenCalledTimes(1);
    tick(1000);
    expect(projectService.updateMetadata).toHaveBeenCalledTimes(1);
    expect(metadataService.updateSettings).toHaveBeenCalledTimes(1);
  }));

  it('flushAll waits for a save started when Settings was destroyed', fakeAsync(() => {
    const pendingEdits = TestBed.inject(PendingEditsService);
    let finishWrite!: () => void;
    projectService.updateMetadata.and.returnValue(new Promise<void>((resolve) => (finishWrite = resolve)));
    component.projectNameControl.setValue('Renamed (switch)');
    tick(200);
    fixture.destroy();

    let flushed = false;
    void pendingEdits.flushAll().then(() => (flushed = true));
    flushMicrotasks();
    expect(flushed).toBeFalse();

    finishWrite();
    flushMicrotasks();
    expect(flushed).toBeTrue();
  }));

  it('does not save an invalid value on leave and says so', fakeAsync(() => {
    component.projectNameControl.setValue('');
    component.settingsForm.patchValue({ promptsFolder: 'x'.repeat(201) });
    tick(200);
    fixture.destroy();
    flushMicrotasks();

    expect(projectService.updateMetadata).not.toHaveBeenCalled();
    expect(metadataService.updateSettings).not.toHaveBeenCalled();
    expect(toasts.showError).toHaveBeenCalledWith('Project name not saved: it is empty or too long.');
    expect(toasts.showError).toHaveBeenCalledWith('Settings not saved: a field has an invalid value.');
  }));

  it('reports a rejected folder (`..`) on leave instead of dropping it silently', fakeAsync(() => {
    metadataService.updateSettings.and.rejectWith(new Error('Invalid settings: promptsFolder: Prompts folder cannot contain parent path (..)'));
    component.settingsForm.patchValue({ promptsFolder: '../outside' });
    tick(200);
    fixture.destroy();
    flushMicrotasks();

    expect(metadataService.updateSettings).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to save settings:', jasmine.any(Error));
  }));

  it('leaving without edits writes nothing', fakeAsync(() => {
    tick(1000);
    fixture.destroy();
    flushMicrotasks();

    expect(projectService.updateMetadata).not.toHaveBeenCalled();
    expect(metadataService.updateSettings).not.toHaveBeenCalled();
    expect(toasts.showError).not.toHaveBeenCalled();
  }));
});
