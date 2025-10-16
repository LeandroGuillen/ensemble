import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Book, Category, Character, CharacterFormData, Project, Tag } from '../../core/interfaces';
import { AiService, CharacterService, ElectronService, MetadataService, ProjectService } from '../../core/services';
import { CategoryToggleComponent, ToggleOption } from '../../shared/category-toggle/category-toggle.component';
import {
  MultiSelectButtonsComponent,
  SelectableItem,
} from '../../shared/multi-select-buttons/multi-select-buttons.component';

@Component({
  selector: 'app-character-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryToggleComponent, MultiSelectButtonsComponent],
  templateUrl: './character-detail.component.html',
  styleUrls: ['./character-detail.component.scss'],
})
export class CharacterDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('nameInput') nameInput?: ElementRef<HTMLInputElement>;

  private destroy$ = new Subject<void>();

  characterForm: FormGroup;
  character: Character | null = null;
  categories: Category[] = [];
  tags: Tag[] = [];
  books: Book[] = [];
  currentProject: Project | null = null;

  // Cache selectable items to avoid recreating arrays on every change detection
  private tagsSelectableItems: SelectableItem[] = [];
  private booksSelectableItems: SelectableItem[] = [];

  isEditing = false;
  isLoading = false;
  isSaving = false;
  error: string | null = null;

  selectedThumbnailPath: string | null = null;
  thumbnailPreview: string | null = null;

  // Additional fields tracking
  additionalFieldsChanges: Record<string, string> = {};

  // AI features
  isGeneratingName = false;
  aiEnabled = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private metadataService: MetadataService,
    private aiService: AiService
  ) {
    this.characterForm = this.createForm();
  }

  ngOnInit(): void {
    // Subscribe to project changes
    this.projectService.currentProject$.pipe(takeUntil(this.destroy$)).subscribe((project) => {
      this.currentProject = project;
      this.categories = this.projectService.getCategories();
      this.tags = this.projectService.getTags();
      this.books = this.metadataService.getBooks();

      // Update cached selectable items
      this.tagsSelectableItems = this.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      }));
      this.booksSelectableItems = this.books.map((book) => ({
        id: book.id,
        name: book.name,
        color: book.color,
      }));

      // Set default category if available
      if (this.categories.length > 0 && !this.isEditing) {
        const defaultCategory =
          this.categories.find((cat) => cat.id === project?.metadata.settings.defaultCategory) || this.categories[0];
        this.characterForm.patchValue({ category: defaultCategory.id });
      }
    });

    // Subscribe to AI settings
    this.aiService
      .getAiSettings()
      .pipe(takeUntil(this.destroy$))
      .subscribe((settings) => {
        this.aiEnabled = settings?.enabled || false;
      });

    const characterId = this.route.snapshot.paramMap.get('id');
    if (characterId && characterId !== 'new') {
      this.isEditing = true;
      this.loadCharacter(characterId);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewInit(): void {
    // Focus the name input after view is initialized
    setTimeout(() => {
      this.nameInput?.nativeElement.focus();
    }, 0);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Escape to cancel
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onCancel();
      return;
    }

    // Ctrl+Enter to save
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      this.onSubmit();
      return;
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(100)]],
      category: ['', Validators.required],
      mangamaster: [''],
      tags: [[]],
      books: [[]],
      thumbnail: [''],
      description: [''],
      notes: [''],
    });
  }

  private async loadCharacter(id: string): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      // Refresh character from disk to get latest changes
      const refreshedCharacter = await this.characterService.refreshCharacter(id);

      if (refreshedCharacter) {
        this.character = refreshedCharacter;

        this.characterForm.patchValue({
          name: this.character.name,
          category: this.character.category,
          tags: this.character.tags,
          books: this.character.books,
          thumbnail: this.character.thumbnail,
          description: this.character.description,
          notes: this.character.notes,
        });

        // Set thumbnail preview
        if (this.character.thumbnail && this.character.folderPath) {
          this.loadThumbnailPreview(`${this.character.folderPath}/${this.character.thumbnail}`);
        }

        // Initialize additional fields tracking
        this.additionalFieldsChanges = {};
      } else {
        this.error = 'Character not found';
      }
    } catch (error) {
      this.error = `Failed to load character: ${error}`;
      console.error('Load character error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async onSubmit(): Promise<void> {
    if (this.characterForm.invalid) {
      this.markFormGroupTouched(this.characterForm);
      return;
    }

    if (!this.currentProject) {
      this.error = 'No project loaded';
      return;
    }

    this.isSaving = true;
    this.error = null;

    try {
      const formData: CharacterFormData = {
        ...this.characterForm.value,
        thumbnail: this.selectedThumbnailPath || this.characterForm.value.thumbnail,
      };

      if (this.isEditing && this.character) {
        // Pass additional fields changes if any
        const updatedCharacter = await this.characterService.updateCharacter(
          this.character.id,
          formData,
          Object.keys(this.additionalFieldsChanges).length > 0 ? this.additionalFieldsChanges : undefined
        );
        if (!updatedCharacter) {
          throw new Error('Character not found');
        }
      } else {
        await this.characterService.createCharacter(formData);
      }

      this.router.navigate(['/characters']);
    } catch (error) {
      this.error = `Failed to save character: ${error}`;
      console.error('Save error:', error);
    } finally {
      this.isSaving = false;
    }
  }

  onCancel(): void {
    if (this.characterForm.dirty) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        this.router.navigate(['/characters']);
      }
    } else {
      this.router.navigate(['/characters']);
    }
  }

  onTagChange(tagId: string, checked: boolean): void {
    const currentTags = this.characterForm.get('tags')?.value || [];
    let updatedTags: string[];

    if (checked) {
      updatedTags = [...currentTags, tagId];
    } else {
      updatedTags = currentTags.filter((id: string) => id !== tagId);
    }

    this.characterForm.patchValue({ tags: updatedTags });
    this.characterForm.markAsDirty();
  }

  isTagSelected(tagId: string): boolean {
    const selectedTags = this.characterForm.get('tags')?.value || [];
    return selectedTags.includes(tagId);
  }

  onBookChange(bookId: string, checked: boolean): void {
    const currentBooks = this.characterForm.get('books')?.value || [];
    let updatedBooks: string[];

    if (checked) {
      updatedBooks = [...currentBooks, bookId];
    } else {
      updatedBooks = currentBooks.filter((id: string) => id !== bookId);
    }

    this.characterForm.patchValue({ books: updatedBooks });
    this.characterForm.markAsDirty();
  }

  isBookSelected(bookId: string): boolean {
    const selectedBooks = this.characterForm.get('books')?.value || [];
    return selectedBooks.includes(bookId);
  }

  async selectThumbnail(): Promise<void> {
    try {
      const imagePath = await this.electronService.selectImage();
      if (imagePath) {
        this.selectedThumbnailPath = imagePath;
        await this.loadThumbnailPreview(imagePath);
        this.characterForm.markAsDirty();
      }
    } catch (error) {
      console.error('Failed to select thumbnail:', error);
      this.error = 'Failed to select thumbnail';
    }
  }

  private async loadThumbnailPreview(imagePath: string): Promise<void> {
    try {
      const dataUrl = await this.electronService.getImageAsDataUrl(imagePath);
      this.thumbnailPreview = dataUrl;
    } catch (error) {
      console.error('Failed to load thumbnail preview:', error);
      this.thumbnailPreview = null;
    }
  }

  removeThumbnail(): void {
    this.selectedThumbnailPath = null;
    this.thumbnailPreview = null;
    this.characterForm.patchValue({ thumbnail: '' });
    this.characterForm.markAsDirty();
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.color || '#95a5a6';
  }

  getCategoryTooltip(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    if (!category) return categoryId;

    if (category.description) {
      return category.description;
    }
    return category.name;
  }

  getCategoryToggleOptions(): ToggleOption[] {
    return this.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      tooltip: cat.description || cat.name,
    }));
  }

  getTagsAsSelectableItems(): SelectableItem[] {
    return this.tagsSelectableItems;
  }

  getBooksAsSelectableItems(): SelectableItem[] {
    return this.booksSelectableItems;
  }

  onTagsSelectionChange(selectedIds: string[]): void {
    this.characterForm.patchValue({ tags: selectedIds });
    this.characterForm.markAsDirty();
  }

  onBooksSelectionChange(selectedIds: string[]): void {
    this.characterForm.patchValue({ books: selectedIds });
    this.characterForm.markAsDirty();
  }

  getTagName(tagId: string): string {
    const tag = this.tags.find((t) => t.id === tagId);
    return tag?.name || tagId;
  }

  getTagColor(tagId: string): string {
    const tag = this.tags.find((t) => t.id === tagId);
    return tag?.color || '#95a5a6';
  }

  getFieldError(fieldName: string): string | null {
    const field = this.characterForm.get(fieldName);
    if (field && field.invalid && field.touched) {
      if (field.errors?.['required']) {
        return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is required`;
      }
      if (field.errors?.['minlength']) {
        return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be at least ${
          field.errors['minlength'].requiredLength
        } characters`;
      }
      if (field.errors?.['maxlength']) {
        return `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be no more than ${
          field.errors['maxlength'].requiredLength
        } characters`;
      }
    }
    return null;
  }

  onTagCheckboxChange(event: Event, tagId: string): void {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox) {
      this.onTagChange(tagId, checkbox.checked);
    }
  }

  onCategorySelect(categoryId: string): void {
    this.characterForm.patchValue({ category: categoryId });
    this.characterForm.markAsDirty();
  }

  onTagToggle(tagId: string): void {
    const isSelected = this.isTagSelected(tagId);
    this.onTagChange(tagId, !isSelected);
  }

  onBookToggle(bookId: string): void {
    const isSelected = this.isBookSelected(bookId);
    this.onBookChange(bookId, !isSelected);
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }

  async generateName(): Promise<void> {
    if (!this.aiEnabled) {
      this.error = 'AI is not enabled. Please configure AI settings first.';
      return;
    }

    this.isGeneratingName = true;
    this.error = null;

    try {
      // Build context for name generation
      const categoryId = this.characterForm.get('category')?.value;
      const category = this.categories.find((cat) => cat.id === categoryId);
      const selectedTags = this.characterForm.get('tags')?.value || [];
      const tags = this.tags.filter((tag) => selectedTags.includes(tag.id));

      let context = '';
      if (this.currentProject) {
        context += `Project: ${this.currentProject.metadata.projectName}. `;
      }
      if (category) {
        context += `Category: ${category.name}. `;
      }
      if (tags.length > 0) {
        context += `Tags: ${tags.map((t) => t.name).join(', ')}.`;
      }

      const generatedName = await this.aiService.generateCharacterName({ context });

      if (generatedName) {
        this.characterForm.patchValue({ name: generatedName });
        this.characterForm.markAsDirty();
      }
    } catch (error) {
      console.error('Failed to generate name:', error);
      this.error = error instanceof Error ? error.message : 'Failed to generate name';
    } finally {
      this.isGeneratingName = false;
    }
  }

  // Additional fields methods
  getAdditionalFieldNames(): string[] {
    if (!this.character || !this.character.additionalFields) {
      return [];
    }
    return Object.keys(this.character.additionalFields).sort();
  }

  getAdditionalFieldValue(fieldName: string): string {
    // Check if there are pending changes first
    if (this.additionalFieldsChanges[fieldName] !== undefined) {
      return this.additionalFieldsChanges[fieldName];
    }
    // Otherwise return the original value
    return this.character?.additionalFields[fieldName] || '';
  }

  getFieldFileName(fieldName: string): string {
    // Return the original filename if available
    if (this.character?.additionalFieldsFilenames[fieldName]) {
      return this.character.additionalFieldsFilenames[fieldName];
    }
    // Fallback to converting field name to filename
    return fieldName.toLowerCase().replace(/\s+/g, '-') + '.md';
  }

  onAdditionalFieldChange(fieldName: string, event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.additionalFieldsChanges[fieldName] = textarea.value;
    this.characterForm.markAsDirty();
  }
}
