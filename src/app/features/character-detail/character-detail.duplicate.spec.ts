import { Location } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideRouter, Router, RouterLink, withHashLocation } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject } from 'rxjs';
import { CharacterDetailComponent } from './character-detail.component';
import { Character } from '../../core/interfaces';
import {
  AiService, CharacterService, ElectronService, LoggingService, MetadataService,
  NotificationService, ImageGenerationService, ImagePickerService,
  MetadataHelperService, ProjectService, FileWatcherService, LocationService,
} from '../../core/services';
import { HouseService } from '../../core/services/house.service';
import { ModalService } from '../../core/services/modal.service';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { WikiLinkRenameService } from '../../core/services/wiki-link-rename.service';
import { CharacterDuplicateService } from '../../core/services/character-duplicate.service';
import { MarkdownEditorComponent } from '../../shared/markdown-editor/markdown-editor.component';

describe('Character duplicate notice with router navigation', () => {
  let source = { id: 'source', name: 'Saffi Reed', category: '', tags: [], books: [] } as unknown as Character;
  const project = { path: '/test-project', metadata: { settings: {} } };
  let copy = { ...source, id: 'copy', name: 'Saffi Reed (copy)' };
  let harness: RouterTestingHarness;
  let changes: Subject<{ type: string; path: string }>;

  beforeEach(async () => {
    source = { id: 'source', name: 'Saffi Reed', category: '', tags: [], books: [] } as unknown as Character;
    copy = { ...source, id: 'copy', name: 'Saffi Reed (copy)' };
    changes = new Subject();
    await TestBed.configureTestingModule({
      imports: [CharacterDetailComponent],
      providers: [
        provideRouter([
          { path: 'characters', component: CharacterDetailComponent },
          { path: 'character/:id', component: CharacterDetailComponent },
          { path: 'character-draft/:id', component: CharacterDetailComponent, data: { draft: true } },
        ], withHashLocation()),
        { provide: CharacterService, useValue: {
          getCharacterById: (id: string) => id === 'copy' ? copy : source,
          getDraftById: (id: string) => id === 'copy' ? copy : source,
          refreshCharacter: async (id: string) => id === 'copy' ? copy : source,
          duplicateCharacter: async () => copy, getRecordNames: () => [source.name],
        } },
        { provide: ProjectService, useValue: {
          currentProject$: of(project), getCurrentProject: () => project,
          getCategories: () => [], getTags: () => [], getCharacterStyles: () => [],
          getDefaultCharacterStyle: () => '', getLastCharacterListStyle: () => null,
        } },
        { provide: LocationService, useValue: { getLocations: () => of([]), loadLocations: async () => {}, getLocationsSnapshot: () => [] } },
        { provide: HouseService, useValue: { loadHouses: async () => {}, getSnapshot: () => [] } },
        { provide: WikiLinkTargetsService, useValue: { targets$: () => of({ resolve: () => null, suggestions: [] }) } },
        { provide: WikiLinkRenameService, useValue: {} },
        { provide: FileWatcherService, useValue: { fileChanges$: changes } },
        { provide: AiService, useValue: { getAiSettings: () => of(null) } },
        { provide: MetadataService, useValue: { getBooks: () => [] } },
        { provide: ElectronService, useValue: { setBrowserNavigationInterception: () => {} } },
        { provide: ImagePickerService, useValue: { close: () => {} } },
        ...[LoggingService, NotificationService, ImageGenerationService, MetadataHelperService, ModalService]
          .map(provide => ({ provide, useValue: {
            showSuccess: () => {}, showError: (message: string) => fail(message), error: () => {},
          } })),
      ],
    }).overrideComponent(CharacterDetailComponent, {
      set: { imports: [FormsModule, ReactiveFormsModule, RouterLink, MarkdownEditorComponent], schemas: [NO_ERRORS_SCHEMA] },
    }).compileComponents();
    harness = await RouterTestingHarness.create();
  });

  async function settle(): Promise<void> {
    harness.detectChanges();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.detectChanges();
    // The page schedules name focus after its debounced route load.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  for (const entry of ['page', 'shared list/grid/palette action']) {
    it(`shows the notice after duplicating from ${entry} and retains it across refresh until dismissal`, async () => {
      const page = await harness.navigateByUrl(entry === 'page' ? '/character/source' : '/characters', CharacterDetailComponent);
      await settle();
      // List, grid and palette all delegate to this same service.
      if (entry === 'page') await page.duplicateCharacter();
      else await TestBed.inject(CharacterDuplicateService).duplicate(source);
      await settle();
      const component = harness.routeDebugElement!.componentInstance as CharacterDetailComponent;
      const note = () => harness.routeNativeElement!.querySelector('.duplicate-note');
      expect(TestBed.inject(Router).url).toBe('/character/copy');
      expect(note()?.textContent).toContain('Copy of Saffi Reed');
      expect(note()?.textContent).toContain('Aliases stay with the original');
      expect(note()?.textContent).toContain('Houses, casts, pinboards, plot threads and book PoV');
      expect(note()?.textContent).toContain('were not copied');
      const location = TestBed.inject(Location);
      const state = location.getState() as { navigationId: number; duplicatedFrom: string };
      expect(state.duplicatedFrom).toBe(source.name);
      const input = harness.routeNativeElement!.querySelector('#name') as HTMLInputElement;
      input.blur();
      await (component as any).loadCharacter('copy');
      await settle();
      expect(note()).not.toBeNull();
      expect(document.activeElement).not.toBe(input);
      (note()!.querySelector('button') as HTMLButtonElement).click();
      await settle();
      expect(note()).toBeNull();
      expect(location.getState()).toEqual(jasmine.objectContaining({ navigationId: state.navigationId }));
      expect((location.getState() as any).duplicatedFrom).toBeUndefined();
      expect(TestBed.inject(Router).url).toBe('/character/copy');
      await (component as any).loadCharacter('copy');
      await settle();
      expect(note()).toBeNull();
      await harness.navigateByUrl('/character/source');
      await settle();
      expect(note()).toBeNull();
    });
  }
  for (const kind of ['character', 'draft', 'Lore']) {
    it(`retains an undismissed ${kind} notice across leaving and returning, and never restores a dismissed notice`, async () => {
      source = { ...source, draft: kind === 'draft', lore: kind === 'Lore' };
      copy = { ...copy, draft: source.draft, lore: source.lore };
      const route = kind === 'draft' ? 'character-draft' : 'character';
      await harness.navigateByUrl(`/${route}/source`);
      await settle();
      await TestBed.inject(CharacterDuplicateService).duplicate(source);
      await settle();
      const note = () => harness.routeNativeElement!.querySelector('.duplicate-note');
      expect(note()).not.toBeNull();

      // Reuse the detail component for another id, then return without duplicate router state.
      await harness.navigateByUrl(`/${route}/source`);
      await settle();
      expect(note()).toBeNull();
      await harness.navigateByUrl(`/${route}/copy`);
      await settle();
      expect(note()?.textContent).toContain('Copy of Saffi Reed');

      // Leaving for another route destroys the page; the notice must survive that too.
      await harness.navigateByUrl('/characters');
      await settle();
      await harness.navigateByUrl(`/${route}/copy`);
      await settle();
      expect(note()?.textContent).toContain('Copy of Saffi Reed');
      (note()?.querySelector('button') as HTMLButtonElement | null)?.click();
      await settle();
      expect(note()).toBeNull();
      await harness.navigateByUrl('/characters');
      await settle();
      // Even an older history entry carrying the original state cannot resurrect the notice.
      await TestBed.inject(Router).navigate([`/${route}`, 'copy'], { state: { duplicatedFrom: source.name } });
      await settle();
      expect(note()).toBeNull();
    });
  }

});
