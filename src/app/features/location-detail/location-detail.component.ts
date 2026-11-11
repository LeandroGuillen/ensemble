import { ProjectReadOnlyDirective } from '../../shared/project-read-only.directive';
import { WikiLinkRenameService } from '../../core/services/wiki-link-rename.service';
import {
  DestroyRef,
  inject,
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  NgZone,
} from '@angular/core';
import { combineLatest, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location as AngularLocation } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Book } from '../../core/interfaces/project.interface';
import { LOCATION_TYPES, Location } from '../../core/interfaces/location.interface';
import { ProjectImage } from '../../core/interfaces';
import {
  MetadataService,
  LocationService,
  ProjectService,
  LoggingService,
  NotificationService,
  ModalService,
  ImagePickerService,
  ElectronService,
} from '../../core/services';
import { MultiSelectButtonsComponent, SelectableItem } from '../../shared/multi-select-buttons/multi-select-buttons.component';
import { ImagePickerDialogComponent } from '../../shared/image-picker-dialog/image-picker-dialog.component';
import { formatThumbnailWikiLink, parseThumbnailReference, resolveThumbnailPath } from '../../core/utils/thumbnail.utils';
import { ResolvedWikiLink, WikiLinkSuggestion } from '../../core/utils/wiki-links.utils';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { MarkdownEditorComponent } from '../../shared/markdown-editor/markdown-editor.component';
import { MentionedInComponent } from '../../shared/mentioned-in/mentioned-in.component';
import { getBookDisplayName } from '../../core/utils/book-display.utils';
import { LocationTypeSelectComponent } from '../../shared/location-type-select/location-type-select.component';
import { isTrashStagingError } from '../../core/trash/trash-record-id';
import { buildDeleteReferencesMessage } from '../../shared/utils/reference-message.utils';

@Component({
  selector: 'app-location-detail',
  imports: [
    ProjectReadOnlyDirective,
    ReactiveFormsModule,
    MultiSelectButtonsComponent,
    ImagePickerDialogComponent,
    LocationTypeSelectComponent,
    MarkdownEditorComponent,
    MentionedInComponent,
  ],
  templateUrl: './location-detail.component.html',
  styleUrls: ['./location-detail.component.scss'],
})
export class LocationDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() embedded = false;
  @Input() onMap = false;
  @Input() mapReadOnly = false;
  @Input() destinationMaps: { id: string; name: string }[] = [];
  @Input() activeMapId = '';
  @Output() destinationOpen = new EventEmitter<string>();
  get destinationMap() { return this.destinationMaps.find(map => map.id === this.locationForm.get('destinationMapId')?.value); }
  async openDestination(): Promise<void> {
    const id = this.destinationMap?.id;
    if (!id || id === this.activeMapId) return;
    if (await this.flushAutoSave(false)) this.destinationOpen.emit(id);
  }
  @Output() placementChange = new EventEmitter<boolean>();
  aliasDraft = '';
  saveError = '';
  private pendingAutoSave: Promise<void> | null = null;
  private createdRoutePending = false;
  private deleting = false;
  private readonly linkRename = inject(WikiLinkRenameService);
  private readonly toasts = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('nameInput') nameInput?: ElementRef<HTMLInputElement>;

  readonly locationTypes = LOCATION_TYPES;

  locationId: string | null = null;
  isNewLocation = false;
  location: Location | null = null;

  locationForm: FormGroup;
  books: Book[] = [];
  bookSelectItems: SelectableItem[] = [];

  thumbnailPreviewUrl: string | null = null;
  showImagePickerDialog = false;

  newLocationFromLink: string | null = null;
  /** Resolves [[wikilinks]] in the description editor. */
  linkResolver: (target: string) => ResolvedWikiLink | null = () => null;
  /** `[[` completion entries: locations, characters (with aliases) and Houses. */
  linkSuggestions: WikiLinkSuggestion[] = [];
  private readonly wikiLinkTargets = inject(WikiLinkTargetsService);
  private leavePrompt: Promise<boolean> | null = null;

  loadError = '';
  private loadGeneration = 0;
  isLoading = false;
  isSaving = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private angularLocation: AngularLocation,
    private fb: FormBuilder,
    private metadataService: MetadataService,
    private locationService: LocationService,
    private projectService: ProjectService,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private modalService: ModalService,
    private imagePickerService: ImagePickerService,
    private electronService: ElectronService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {
    this.locationForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/\S/)]],
      aliasesText: [''],
      mapIcon: [''],
      destinationMapId: [''],
      type: [''],
      books: [[] as string[]],
      thumbnail: [''],
      content: [''],
    });
  }

  ngOnInit(): void {
    this.wikiLinkTargets.targets$('location')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ resolve, suggestions }) => {
        this.linkResolver = resolve;
        this.linkSuggestions = suggestions;
        this.cdr.markForCheck();
      });
    this.locationForm.valueChanges.pipe(debounceTime(700), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.embedded && this.locationForm.dirty && document.activeElement !== this.nameInput?.nativeElement) void this.flushAutoSave();
      });
    void this.ensureLocationsLoaded();

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(debounceTime(0), takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, queryParams]) => {
        const id = params.get('id');
        this.isNewLocation = !id;
        this.locationId = id;
        this.newLocationFromLink = !id && queryParams.get('fromLink') === '1'
          ? queryParams.get('name') : null;
        void this.loadLocation();
      });

    this.metadataService.metadata$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((metadata) => {
        if (!metadata) {
          return;
        }
        this.books = metadata.books || [];
        this.bookSelectItems = this.books.map((book) => ({
          id: book.id,
          name: getBookDisplayName(book),
          color: book.color,
        }));
        this.cdr.markForCheck();
      });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.nameInput?.nativeElement.focus();
    }, 0);

    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.keydownListener);
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownListener);
    this.imagePickerService.close();
  }

  private keydownListener = (event: KeyboardEvent) => {
    // The description editor uses Escape itself (closing completion/search).
    if (event.key === 'Escape' && !event.defaultPrevented) {
      if (document.querySelector('.location-help:popover-open')) return;
      event.preventDefault();
      this.ngZone.run(() => {
        if (this.showImagePickerDialog || this.imagePickerService.isOpen) {
          this.closeImagePicker();
          return;
        }
        void this.cancel();
      });
      return;
    }
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      this.ngZone.run(() => {
        void this.flushAutoSave();
      });
    }
  };

  private async ensureLocationsLoaded(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      return;
    }
    try {
      await this.locationService.loadLocations(project.path);
    } catch (error) {
      this.logger.error('Failed to load locations:', error);
    }
  }

  private async loadLocation(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loadError = '';
    this.saveError = '';
    this.aliasDraft = '';
    if (this.isNewLocation) {
      this.location = null;
      this.locationForm.reset({
        name: this.newLocationFromLink || '',
        aliasesText: '',
        mapIcon: '',
        destinationMapId: '',
        type: '',
        books: [],
        thumbnail: '',
        content: '',
      }, { emitEvent: false });
      this.thumbnailPreviewUrl = null;
      return;
    }

    if (!this.locationId) {
      return;
    }

    this.isLoading = true;
    try {
      await this.ensureLocationsLoaded();
      if (generation !== this.loadGeneration || this.destroyRef.destroyed) return;
      const location = this.locationService.getLocationById(this.locationId);
      if (!location) {
        this.location = null;
        this.loadError = 'Location not found';
        this.toasts.showError('Location not found');
        return;
      }

      this.location = location;
      this.locationForm.patchValue({
        name: location.name,
        aliasesText: (location.aliases || []).join('\n'),
        mapIcon: location.mapIcon || '',
        destinationMapId: location.destinationMapId || '',
        type: location.type || '',
        books: location.books || [],
        thumbnail: location.thumbnail || '',
        content: location.content || '',
      }, { emitEvent: false });
      this.locationForm.markAsPristine();
      await this.refreshThumbnailPreview();
    } catch (error) {
      this.loadError = `Failed to load location: ${error}`;
      this.toasts.showError(this.loadError);
      this.logger.error('Failed to load location:', error);
    } finally {
      if (generation === this.loadGeneration && !this.destroyRef.destroyed) {
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    }
  }

  /** Unsaved changes are confirmed by the route's leave guard (`canLeave`). */
  async openDescriptionLink(href: string): Promise<void> {
    if (!/^#\/(character-draft|character|location|house)(?:\/|\?)/.test(href)) return;
    const destination = href.slice(1);
    if (destination === `/location/${encodeURIComponent(this.locationId || '')}`) return;
    await this.router.navigateByUrl(destination);
  }

  onBooksChange(bookIds: string[]): void {
    this.locationForm.patchValue({ books: bookIds });
    this.locationForm.markAsDirty();
  }

  async openImagePicker(): Promise<void> {
    this.showImagePickerDialog = true;
    this.cdr.markForCheck();
    await this.imagePickerService.open({
      thumbnailHint: this.locationForm.get('thumbnail')?.value || '',
      imagesFolder: this.projectService.getCurrentProject()?.metadata?.settings?.imagesFolder,
    });
    const loadError = this.imagePickerService.snapshot.error;
    if (loadError) {
      this.notificationService.showError(loadError);
      this.cdr.markForCheck();
    }
  }

  closeImagePicker(): void {
    this.imagePickerService.close();
    this.showImagePickerDialog = false;
    this.cdr.markForCheck();
  }

  onImageSelected(image: ProjectImage): void {
    this.locationForm.patchValue({
      thumbnail: formatThumbnailWikiLink(image.relativePath),
    });
    this.locationForm.markAsDirty();
    this.showImagePickerDialog = false;
    void this.refreshThumbnailPreview();
    this.cdr.markForCheck();
  }

  removeThumbnail(): void {
    this.locationForm.patchValue({ thumbnail: '' });
    this.locationForm.markAsDirty();
    this.thumbnailPreviewUrl = null;
  }

  private async refreshThumbnailPreview(): Promise<void> {
    const thumbnail = this.locationForm.get('thumbnail')?.value;
    if (!thumbnail) {
      this.thumbnailPreviewUrl = null;
      return;
    }

    if (this.location && this.location.thumbnail === thumbnail) {
      const cached = this.locationService.getCachedThumbnail(this.location.id);
      if (cached) {
        this.thumbnailPreviewUrl = cached;
        return;
      }
      this.thumbnailPreviewUrl = await this.locationService.loadThumbnailForLocation(this.location);
      return;
    }

    const project = this.projectService.getCurrentProject();
    const parsed = parseThumbnailReference(thumbnail);
    if (!project?.path || !parsed) {
      this.thumbnailPreviewUrl = null;
      return;
    }

    try {
      this.thumbnailPreviewUrl = await this.electronService.getImageAsDataUrl(
        resolveThumbnailPath(project.path, parsed)
      );
    } catch (error) {
      this.logger.error('Failed to preview location thumbnail:', error);
      this.thumbnailPreviewUrl = null;
    }
  }

  private async navigateBackAfterSave(): Promise<void> {
    if (this.embedded) {
      if (this.locationId && this.isNewLocation) await this.router.navigate(['/location', this.locationId], { queryParamsHandling: 'preserve' });
      return;
    }
    if (window.history.length > 1) {
      this.angularLocation.back();
      return;
    }
    await this.router.navigate(['/locations'], { queryParamsHandling: 'preserve' });
  }

  get aliases(): string[] {
    return (this.locationForm.get('aliasesText')?.value || '').split('\n').filter(Boolean);
  }
  onAliasInput(event: Event): void { this.aliasDraft = (event.target as HTMLInputElement).value; }
  onAliasKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); this.addAlias(); }
    else if (event.key === 'Backspace' && !this.aliasDraft && this.aliases.length) this.removeAlias(this.aliases.length - 1);
  }
  addAlias(): void {
    const value = this.aliasDraft?.trim();
    this.aliasDraft = '';
    if (!value || value.toLowerCase() === this.locationForm.get('name')?.value.trim().toLowerCase() || this.aliases.some(alias => alias.toLowerCase() === value.toLowerCase())) return;
    this.locationForm.patchValue({ aliasesText: [...this.aliases, value].join('\n') });
    this.locationForm.markAsDirty();
  }
  removeAlias(index: number): void {
    this.locationForm.patchValue({ aliasesText: this.aliases.filter((_, i) => i !== index).join('\n') });
    this.locationForm.markAsDirty();
  }
  onFieldBlur(): void {
    // Name edits commit on blur, so renaming never runs halfway through typing.
    if (this.embedded) void this.flushAutoSave();
  }

  async flushAutoSave(updateRoute = true): Promise<boolean> {
    this.addAlias();
    if (this.deleting) return true;
    if (!this.pendingAutoSave) {
      this.pendingAutoSave = (async () => {
        while (this.locationForm.dirty) {
          if (this.locationForm.invalid || this.isLoading || this.loadError || this.projectService?.getCurrentProject()?.readOnly) {
            this.locationForm.markAllAsTouched();
            return;
          }
          const before = JSON.stringify(this.locationForm.getRawValue());
          await this.saveLocation(true);
          // Failure keeps the form dirty and stops automatic retries until another
          // edit or Retry. New edits made during a write get their own next save.
          if (this.saveError || (this.locationForm.dirty && before === JSON.stringify(this.locationForm.getRawValue()))) return;
        }
      })();
    }
    try { await this.pendingAutoSave; }
    finally { this.pendingAutoSave = null; }
    const saved = !this.locationForm.dirty;
    if (saved && updateRoute && this.createdRoutePending && !this.router.getCurrentNavigation?.()) {
      this.createdRoutePending = false;
      await this.router.navigate(['/location', this.locationId], { replaceUrl: true, queryParamsHandling: 'preserve' });
    }
    return saved;
  }

  async saveLocation(automatic = false): Promise<void> {
    if (this.isSaving || this.isLoading || this.loadError || this.deleting || this.projectService?.getCurrentProject()?.readOnly) return;
    if (this.locationForm.invalid) { this.locationForm.markAllAsTouched(); return; }
    this.isSaving = true;
    this.saveError = '';
    const formData = this.locationForm.getRawValue();
    const fingerprint = JSON.stringify(formData);
    try {
      const payload = {
        name: formData.name.trim(),
        aliases: (formData.aliasesText || '').split('\n').map((alias: string) => alias.trim()).filter(Boolean),
        mapIcon: formData.mapIcon || undefined,
        destinationMapId: formData.destinationMapId || undefined,
        type: formData.type || undefined,
        books: formData.books || [],
        thumbnail: formData.thumbnail?.trim() || undefined,
        content: formData.content || '',
      };
      const wasNew = this.isNewLocation;
      const updated = wasNew
        ? await this.locationService.createLocation(payload)
        : await this.linkRename.run(this.location!, payload.name, 'location', () => this.locationService.updateLocation(this.locationId!, payload));
      if (!updated) throw new Error('Location not found');
      this.location = updated;
      this.locationId = updated.id;
      // Never overwrite typing that happened while the disk write or rename
      // dialog was pending. Keep link rewrites for fields that weren't edited.
      const current = this.locationForm.getRawValue();
      const patch: Record<string, unknown> = {};
      if (current.name === formData.name) patch['name'] = updated.name;
      if (current.aliasesText === formData.aliasesText) patch['aliasesText'] = (updated.aliases || []).join('\n');
      if (current.content === formData.content) patch['content'] = updated.content;
      this.locationForm.patchValue(patch, { emitEvent: false });
      if (fingerprint === JSON.stringify(current)) this.locationForm.markAsPristine();
      this.isSaving = false;
      if (automatic) {
        if (wasNew) { this.isNewLocation = false; this.createdRoutePending = true; }
      } else {
        this.notificationService.showSuccess(`${wasNew ? 'Created' : 'Saved'} ${updated.name}`);
        await this.navigateBackAfterSave();
      }
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : 'Could not save location';
      this.logger.error('Failed to save location:', error);
      if (!automatic) this.toasts.showError(this.saveError);
    } finally {
      this.isSaving = false;
      this.cdr.markForCheck();
    }
  }

  async deleteLocation(): Promise<void> {
    if (!this.location) {
      return;
    }
    let references = '';
    try {
      references = buildDeleteReferencesMessage(
        await this.locationService.countLocationReferences(this.location.id),
        'location'
      );
    } catch (error) {
      this.logger.error('Failed to count location references', error);
    }
    if (
      !(await this.modalService.confirm(
        `Are you sure you want to delete the location "${this.location.name}"?${references}\n\nIt will be moved to the system Trash. You can undo for 15 seconds. After that, restore it from the system Trash (links in Houses and prompts come back only with Undo).`,
        'Delete location',
        { confirmText: 'Delete location', danger: true }
      ))
    ) {
      return;
    }

    this.deleting = true;
    if (this.pendingAutoSave) await this.pendingAutoSave;
    try {
      await this.locationService.deleteLocation(this.location.id);
      this.locationForm.markAsPristine();
      // Undo toast is shown by UndoDeleteService.register.
      await this.router.navigate(['/locations'], { queryParamsHandling: 'preserve' });
    } catch (error) {
      this.logger.error('Failed to delete location:', error);
      // Staging/rollback toasts come from the service (TrashStagingError).
      // Service already prefixes "Failed to delete location:"; use its message once.
      this.deleting = false;
      if (!isTrashStagingError(error)) {
        this.toasts.showError(error instanceof Error ? error.message : `Failed to delete location: ${error}`);
      }
    }
  }

  /** Unsaved changes are confirmed once, by the route's leave guard (`canLeave`). */
  async cancel(): Promise<void> {
    await this.router.navigate(['/locations'], { queryParamsHandling: 'preserve' });
  }

  getFieldError(field: string): string | null {
    const control = this.locationForm.get(field);
    if (!control || !control.touched || !control.errors) {
      return null;
    }
    if (control.errors['required']) {
      return 'This field is required';
    }
    if (control.errors['pattern']) return 'Enter a location name';
    if (control.errors['maxlength']) {
      return 'Value is too long';
    }
    return 'Invalid value';
  }

  /**
   * Route leave guard. Uses the in-app modal: a native window.confirm() leaves the Electron
   * window unable to take keyboard focus. A prompt already on screen is reused.
   */
  canLeave(discardAndClose = false): boolean | Promise<boolean> {
    if (this.deleting) return true;
    this.addAlias();
    if (!discardAndClose && !this.imagePickerService.handleNavigationAway()) return false;
    if (!this.locationForm.dirty && !this.isSaving) return true;
    if (!discardAndClose && this.embedded && !this.locationForm.invalid && (!this.isSaving || this.pendingAutoSave)) return this.flushAutoSave(false);
    if (!discardAndClose && this.isSaving) return false;
    this.leavePrompt ??= this.modalService.confirm(
      discardAndClose ? 'This project is read-only. Discard your unsaved changes and close?' : 'You have unsaved changes. Are you sure you want to leave?', 'Discard Changes',
      { confirmText: discardAndClose ? 'Discard and close' : 'Discard', cancelText: 'Keep Editing', danger: false }
    ).finally(() => { this.leavePrompt = null; });
    return this.leavePrompt;
  }
}
