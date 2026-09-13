import { DestroyRef, inject, Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Book, Category, Tag } from '../../core/interfaces/project.interface';
import { Location } from '../../core/interfaces/location.interface';
import { ProjectImage } from '../../core/interfaces';
import {
  MetadataService,
  LocationService,
  ProjectService,
  LoggingService,
  NotificationService,
  ModalService,
  MetadataHelperService,
  ImagePickerService,
  ElectronService,
} from '../../core/services';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { CategoryToggleComponent, ToggleOption } from '../../shared/category-toggle/category-toggle.component';
import { MultiSelectButtonsComponent, SelectableItem } from '../../shared/multi-select-buttons/multi-select-buttons.component';
import { ImagePickerDialogComponent } from '../../shared/image-picker-dialog/image-picker-dialog.component';
import { formatThumbnailWikiLink, parseThumbnailReference, resolveThumbnailPath } from '../../core/utils/thumbnail.utils';
import { contrastTextColor } from '../../core/utils/color-contrast.utils';

@Component({
  selector: 'app-location-detail',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    PageHeaderComponent,
    CategoryToggleComponent,
    MultiSelectButtonsComponent,
    ImagePickerDialogComponent,
  ],
  templateUrl: './location-detail.component.html',
  styleUrls: ['./location-detail.component.scss'],
})
export class LocationDetailComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  locationId: string | null = null;
  isNewLocation = false;
  location: Location | null = null;

  locationForm: FormGroup;
  categories: Category[] = [];
  tags: Tag[] = [];
  books: Book[] = [];
  categoryToggleOptions: ToggleOption[] = [];
  tagSelectItems: SelectableItem[] = [];
  bookSelectItems: SelectableItem[] = [];

  thumbnailPreviewUrl: string | null = null;
  showImagePickerDialog = false;

  isLoading = false;
  isSaving = false;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private metadataService: MetadataService,
    private locationService: LocationService,
    private projectService: ProjectService,
    private logger: LoggingService,
    private notificationService: NotificationService,
    private modalService: ModalService,
    private metadataHelper: MetadataHelperService,
    private imagePickerService: ImagePickerService,
    private electronService: ElectronService,
    private cdr: ChangeDetectorRef
  ) {
    this.locationForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      category: ['', Validators.required],
      tags: [[] as string[]],
      books: [[] as string[]],
      thumbnail: [''],
      content: [''],
    });
  }

  ngOnInit(): void {
    void this.ensureLocationsLoaded();

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      this.isNewLocation = !id;
      this.locationId = id;
      void this.loadLocation();
    });

    this.metadataService.metadata$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((metadata) => {
        if (!metadata) {
          return;
        }
        this.categories = metadata.categories || [];
        this.tags = metadata.tags || [];
        this.books = metadata.books || [];
        this.categoryToggleOptions = this.categories.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          tooltip: c.description,
        }));
        this.tagSelectItems = this.tags.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          activeTextColor: contrastTextColor(t.color),
        }));
        this.bookSelectItems = this.books.map((b) => ({
          id: b.id,
          name: b.name,
          color: b.color,
          activeTextColor: contrastTextColor(b.color),
        }));

        if (this.isNewLocation && !this.locationForm.get('category')?.value) {
          const defaultCategory =
            metadata.settings?.defaultCategory || this.categories[0]?.id || '';
          this.locationForm.patchValue({ category: defaultCategory });
        }
        this.cdr.markForCheck();
      });
  }

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
    if (this.isNewLocation) {
      this.location = null;
      const defaultCategory =
        this.projectService.getCurrentProject()?.metadata?.settings?.defaultCategory ||
        this.categories[0]?.id ||
        '';
      this.locationForm.reset({
        name: '',
        category: defaultCategory,
        tags: [],
        books: [],
        thumbnail: '',
        content: '',
      });
      this.thumbnailPreviewUrl = null;
      return;
    }

    if (!this.locationId) {
      return;
    }

    this.isLoading = true;
    try {
      await this.ensureLocationsLoaded();
      const location = this.locationService.getLocationById(this.locationId);
      if (!location) {
        this.error = 'Location not found';
        return;
      }

      this.location = location;
      this.locationForm.patchValue({
        name: location.name,
        category: location.category,
        tags: location.tags || [],
        books: location.books || [],
        thumbnail: location.thumbnail || '',
        content: location.content || '',
      });
      this.locationForm.markAsPristine();
      await this.refreshThumbnailPreview();
    } catch (error) {
      this.error = `Failed to load location: ${error}`;
      this.logger.error('Failed to load location:', error);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  onCategorySelect(categoryId: string): void {
    this.locationForm.patchValue({ category: categoryId });
    this.locationForm.markAsDirty();
  }

  onTagsChange(tagIds: string[]): void {
    this.locationForm.patchValue({ tags: tagIds });
    this.locationForm.markAsDirty();
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

  async saveLocation(): Promise<void> {
    if (this.locationForm.invalid) {
      this.locationForm.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    this.error = null;
    try {
      const formData = this.locationForm.getRawValue();
      const payload = {
        name: formData.name.trim(),
        category: formData.category,
        tags: formData.tags || [],
        books: formData.books || [],
        thumbnail: formData.thumbnail?.trim() || undefined,
        content: formData.content || '',
      };

      if (this.isNewLocation) {
        const created = await this.locationService.createLocation(payload);
        this.notificationService.showSuccess(`Created ${created.name}`);
        await this.router.navigate(['/location', created.id], { replaceUrl: true });
      } else if (this.locationId) {
        const updated = await this.locationService.updateLocation(this.locationId, payload);
        if (!updated) {
          throw new Error('Location not found');
        }
        this.location = updated;
        this.locationId = updated.id;
        this.locationForm.markAsPristine();
        this.notificationService.showSuccess(`Saved ${updated.name}`);
        if (updated.id !== this.route.snapshot.paramMap.get('id')) {
          await this.router.navigate(['/location', updated.id], { replaceUrl: true });
        }
      }
    } catch (error) {
      this.error = `Failed to save location: ${error}`;
      this.logger.error('Failed to save location:', error);
    } finally {
      this.isSaving = false;
      this.cdr.markForCheck();
    }
  }

  async deleteLocation(): Promise<void> {
    if (!this.location) {
      return;
    }
    if (
      !(await this.modalService.confirm(
        `Are you sure you want to delete the location "${this.location.name}"?`
      ))
    ) {
      return;
    }

    try {
      await this.locationService.deleteLocation(this.location.id);
      this.notificationService.showSuccess(`Deleted ${this.location.name}`);
      await this.router.navigate(['/locations']);
    } catch (error) {
      this.error = `Failed to delete location: ${error}`;
      this.logger.error('Failed to delete location:', error);
    }
  }

  async cancel(): Promise<void> {
    if (this.locationForm.dirty) {
      if (!(await this.modalService.confirm('Discard unsaved changes?'))) {
        return;
      }
    }
    await this.router.navigate(['/locations']);
  }

  getFieldError(field: string): string | null {
    const control = this.locationForm.get(field);
    if (!control || !control.touched || !control.errors) {
      return null;
    }
    if (control.errors['required']) {
      return 'This field is required';
    }
    if (control.errors['maxlength']) {
      return 'Value is too long';
    }
    return 'Invalid value';
  }
}
