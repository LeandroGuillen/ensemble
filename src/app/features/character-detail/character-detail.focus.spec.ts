import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideRouter, RouterLink } from '@angular/router';
import { CharacterDetailComponent } from './character-detail.component';
import {
  AiService, CharacterService, ElectronService, LoggingService, MetadataService,
  NotificationService, ImageGenerationService, ImagePickerService,
  MetadataHelperService, ProjectService, FileWatcherService, LocationService,
} from '../../core/services';
import { ModalService } from '../../core/services/modal.service';
import { HouseService } from '../../core/services/house.service';
import { MarkdownEditorComponent } from '../../shared/markdown-editor/markdown-editor.component';

describe('Character detail focused loading', () => {
  it('renders asynchronously loaded details while the name keeps focus', async () => {
    const services = [AiService, CharacterService, LoggingService, MetadataService,
      NotificationService, ImageGenerationService, MetadataHelperService,
      ProjectService, FileWatcherService, LocationService, HouseService, ModalService];
    await TestBed.configureTestingModule({
      imports: [CharacterDetailComponent],
      providers: [
        provideRouter([]), FormBuilder,
        ...services.map(provide => ({ provide, useValue: {} })),
        { provide: ElectronService, useValue: { setBrowserNavigationInterception: () => undefined } },
        { provide: ImagePickerService, useValue: { close: () => undefined } },
      ],
    }).overrideComponent(CharacterDetailComponent, {
      set: { imports: [FormsModule, ReactiveFormsModule, RouterLink, MarkdownEditorComponent], schemas: [NO_ERRORS_SCHEMA] },
    }).compileComponents();
    // Isolate the focus/rendering behavior from project and file I/O.
    spyOn(CharacterDetailComponent.prototype, 'ngOnInit').and.stub();
    const fixture = TestBed.createComponent(CharacterDetailComponent);
    fixture.componentInstance.currentProject = { path: '/project', metadata: { settings: {} } } as any;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    const input = fixture.nativeElement.querySelector('#name') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    await new Promise<void>(resolve => setTimeout(() => {
      component.characterForm.patchValue({ name: 'Ada', category: 'lead', tags: ['brave'], content: 'Loaded description' });
      component.categories = [{ id: 'lead', name: 'Lead', color: '#3498db' }];
      component.tags = [{ id: 'brave', name: 'Brave', color: '#3498db' }];
      component.selectedStyleId = 'portrait';
      component.thumbnailPreviewUrls.set('portrait', 'data:image/png;base64,iVBORw0KGgo=');
      (component as any).cdr.markForCheck();
      resolve();
    }, 0));
    await fixture.whenStable();

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Ada');
    expect(fixture.nativeElement.querySelector('.hero-thumb img')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.form-group-category')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tags-select')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#content .cm-content').textContent).toContain('Loaded description');

    // The book context sits above the portrait and exposes a visible reset.
    component.books = [{ id: 'first', name: 'First book', color: '#3498db' }] as any;
    component.contentTabs = [{ id: 'main', label: 'General' }, { id: 'first', label: 'First book' }];
    component.activeContentTab = 'first';
    component.thumbnailsMap = { portrait: 'main.png' };
    component.bookThumbnailsMap = { first: { portrait: 'first.png' } };
    spyOn(component, 'getBookName').and.returnValue('First book');
    spyOn(component, 'refreshThumbnailPreviews').and.resolveTo();
    (component as any).cdr.markForCheck();
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelector('.content-tabs') as HTMLElement;
    const hero = fixture.nativeElement.querySelector('.hero-card') as HTMLElement;
    expect(tabs.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.portrait-scope').textContent).toContain('Picture for First book');
    expect(fixture.nativeElement.querySelector('.portrait-scope').textContent).toContain('Only used in this book');
    (fixture.nativeElement.querySelector('.portrait-scope button') as HTMLButtonElement).click();
    (component as any).cdr.markForCheck();
    fixture.detectChanges();
    expect(component.bookThumbnailsMap['first']).toBeUndefined();
    expect(component.thumbnailsMap['portrait']).toBe('main.png');
    expect(fixture.nativeElement.querySelector('.portrait-scope').textContent).toContain('Using main picture');
    expect(fixture.nativeElement.querySelector('.portrait-change-btn').textContent).toContain('Set book picture');

  });
});
