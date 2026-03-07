import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Location } from "@angular/common";
import { Subject } from "rxjs";
import { debounceTime, takeUntil } from "rxjs/operators";
import {
  Book,
  Category,
  Character,
  CharacterFormData,
  Project,
  Tag,
} from "../../core/interfaces";
import {
  AiService,
  CharacterService,
  ElectronService,
  LoggingService,
  MetadataService,
  NotificationService,
  ProjectService,
} from "../../core/services";
import { ModalService } from "../../core/services/modal.service";
import { parseThumbnailReference, resolveThumbnailPath } from "../../core/utils/thumbnail.utils";
import {
  CategoryToggleComponent,
  ToggleOption,
} from "../../shared/category-toggle/category-toggle.component";
import {
  MultiSelectButtonsComponent,
  SelectableItem,
} from "../../shared/multi-select-buttons/multi-select-buttons.component";
@Component({
  selector: "app-character-detail",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CategoryToggleComponent,
    MultiSelectButtonsComponent,
  ],
  templateUrl: "./character-detail.component.html",
  styleUrls: ["./character-detail.component.scss"],
})
export class CharacterDetailComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  @ViewChild("nameInput") nameInput?: ElementRef<HTMLInputElement>;

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
  activeTab: 'basic' = 'basic';
  isSaving = false;
  error: string | null = null;



  // AI features
  isGeneratingName = false;
  aiEnabled = false;

  // Thumbnail preview (resolved from img/ path)
  thumbnailPreviewUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private metadataService: MetadataService,
    private aiService: AiService,
    private modalService: ModalService,
    private logger: LoggingService,
    private notificationService: NotificationService
  ) {
    this.characterForm = this.createForm();
  }

  ngOnInit(): void {
    // Subscribe to project changes
    this.projectService.currentProject$
      .pipe(takeUntil(this.destroy$))
      .subscribe((project) => {
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

        // Set default category only when form has no valid selection (don't overwrite user's choice)
        if (this.categories.length > 0 && !this.isEditing) {
          const currentValue = this.characterForm.get('category')?.value;
          const hasValidSelection =
            currentValue && this.categories.some((c) => c.id === currentValue);
          if (!hasValidSelection) {
            const defaultCategory =
              this.categories.find(
                (cat) => cat.id === project?.metadata.settings.defaultCategory
              ) || this.categories[0];
            this.characterForm.patchValue({ category: defaultCategory.id });
          }
        }
      });

    // Subscribe to AI settings
    this.aiService
      .getAiSettings()
      .pipe(takeUntil(this.destroy$))
      .subscribe((settings) => {
        this.aiEnabled = settings?.enabled || false;
      });

    // Subscribe to route parameter changes (not just snapshot)
    this.route.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        const characterId = params.get("id");
        if (characterId && characterId !== "new") {
          this.isEditing = true;
          this.loadCharacter(decodeURIComponent(characterId));
        } else {
          this.isEditing = false;
          this.character = null;
          this.characterForm.reset();
        }
      });

    // Check for query params (e.g., from Backstage)
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        if (params["name"] && !this.isEditing) {
          this.characterForm.patchValue({ name: params["name"] });
        }
      });

    // Thumbnail preview: resolve path and load image when thumbnail field changes
    this.characterForm
      .get("thumbnail")
      ?.valueChanges.pipe(
        debounceTime(300),
        takeUntil(this.destroy$)
      )
      .subscribe(async (value) => {
        this.thumbnailPreviewUrl = null;
        if (!value?.trim() || !this.currentProject?.path) {
          return;
        }
        const parsed = parseThumbnailReference(value);
        if (!parsed) {
          return;
        }
        const absolutePath = resolveThumbnailPath(
          this.currentProject.path,
          parsed
        );
        try {
          const dataUrl =
            await this.electronService.getImageAsDataUrl(absolutePath);
          this.thumbnailPreviewUrl = dataUrl;
          this.cdr.markForCheck();
        } catch {
          // Ignore - file may not exist yet
        }
      });
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

  @HostListener("document:keydown", ["$event"])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Escape to cancel
    if (event.key === "Escape") {
      event.preventDefault();
      this.onCancel();
      return;
    }

    // Ctrl+Enter to save
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      this.onSubmit();
      return;
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: [
        "",
        {
          validators: [
            Validators.required,
            Validators.minLength(1),
            Validators.maxLength(100),
          ],
          updateOn: 'blur' // Validate on blur for better UX
        }
      ],
      category: [
        "",
        {
          validators: [Validators.required],
          updateOn: 'change' // Validate immediately on change
        }
      ],
      tags: [[]],
      books: [[]],
      thumbnail: [""],
      content: [
        "",
        {
          validators: [Validators.maxLength(100000)],
          updateOn: 'blur'
        }
      ],
    });
  }

  private async loadCharacter(id: string): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      // First check if character exists in memory
      let character = this.characterService.getCharacterById(id);
      
      // If not found, ensure characters are loaded first
      if (!character && this.currentProject) {
        await this.characterService.loadCharacters(this.currentProject.path);
        character = this.characterService.getCharacterById(id);
      }

      // If still not found, character doesn't exist
      if (!character) {
        this.error = "Character not found";
        this.isLoading = false;
        return;
      }

      // Refresh character from disk to get latest changes
      const refreshedCharacter = await this.characterService.refreshCharacter(
        id
      );

      if (refreshedCharacter) {
        this.character = refreshedCharacter;

        this.characterForm.patchValue({
          name: this.character.name,
          category: this.character.category,
          tags: this.character.tags,
          books: this.character.books,
          thumbnail: this.character.thumbnail || '',
          content: this.character.content || '',
        });
      } else {
        this.error = "Character not found";
      }
    } catch (error) {
      this.error = `Failed to load character: ${error}`;
      this.logger.error("Load character error:", error);
    } finally {
      this.isLoading = false;
    }
  }

  async onSubmit(): Promise<void> {
    if (this.characterForm.invalid) {
      this.markFormGroupTouched(this.characterForm);
      this.highlightRequiredFields();
      this.scrollToFirstInvalidField();
      return;
    }

    if (!this.currentProject) {
      this.error = "No project loaded";
      return;
    }

    this.isSaving = true;
    this.error = null;

    try {
      const formData: CharacterFormData = {
        name: this.characterForm.value.name,
        category: this.characterForm.value.category,
        tags: this.characterForm.value.tags || [],
        books: this.characterForm.value.books || [],
        thumbnail: this.characterForm.value.thumbnail || undefined,
        content: this.characterForm.value.content || '',
      };

      if (this.isEditing && this.character) {
        const updatedCharacter = await this.characterService.updateCharacter(
          this.character.id,
          formData
        );
        if (!updatedCharacter) {
          throw new Error("Character not found");
        }
        this.notificationService.showSuccess("Character saved successfully");
      } else {
        await this.characterService.createCharacter(formData);
        this.notificationService.showSuccess("Character created successfully");
      }

      this.router.navigate(["/characters"]);
    } catch (error) {
      this.error = `Failed to save character: ${error}`;
      this.logger.error("Save error:", error);
    } finally {
      this.isSaving = false;
    }
  }

  async onCancel(): Promise<void> {
    if (this.characterForm.dirty) {
      const confirmed = await this.modalService.confirm(
        "You have unsaved changes. Are you sure you want to leave?",
        "Discard Changes",
        {
          confirmText: "Discard",
          cancelText: "Keep Editing",
          danger: false
        }
      );
      if (confirmed) {
        this.navigateBack();
      }
    } else {
      this.navigateBack();
    }
  }

  private navigateBack(): void {
    // Check if we have a valid previous route within the app
    // The issue: when opening directly to a character page, there's no in-app history
    // Solution: check referrer to see if we came from within the app
    
    const referrer = document.referrer;
    const currentOrigin = window.location.origin;
    
    // Check if referrer is from our app (same origin)
    const isFromApp = referrer && (
      referrer.startsWith(currentOrigin) ||
      referrer.includes('localhost:4200') ||
      referrer.startsWith('file://')
    );

    // If we have a referrer from within the app, try to go back
    // Otherwise, navigate to characters list (safe fallback)
    if (isFromApp && window.history.length > 1) {
      this.location.back();
    } else {
      // No valid in-app history, navigate to characters list
      this.router.navigate(["/characters"]);
    }
  }

  onTagChange(tagId: string, checked: boolean): void {
    const currentTags = this.characterForm.get("tags")?.value || [];
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
    const selectedTags = this.characterForm.get("tags")?.value || [];
    return selectedTags.includes(tagId);
  }

  onBookChange(bookId: string, checked: boolean): void {
    const currentBooks = this.characterForm.get("books")?.value || [];
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
    const selectedBooks = this.characterForm.get("books")?.value || [];
    return selectedBooks.includes(bookId);
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.color || "#95a5a6";
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
    return tag?.color || "#95a5a6";
  }

  getFieldError(fieldName: string): string | null {
    const field = this.characterForm.get(fieldName);
    if (field && field.invalid && (field.touched || field.dirty)) {
      // Show errors if field has been touched or modified
      if (field.errors?.["required"]) {
        const fieldLabel = this.getFieldLabel(fieldName);
        return `${fieldLabel} is required. Please enter a value.`;
      }
      if (field.errors?.["minlength"]) {
        const fieldLabel = this.getFieldLabel(fieldName);
        const requiredLength = field.errors["minlength"].requiredLength;
        const actualLength = field.errors["minlength"].actualLength;
        return `${fieldLabel} is too short. Please enter at least ${requiredLength} character${requiredLength > 1 ? 's' : ''} (currently ${actualLength}).`;
      }
      if (field.errors?.["maxlength"]) {
        const fieldLabel = this.getFieldLabel(fieldName);
        const maxLength = field.errors["maxlength"].requiredLength;
        const actualLength = field.errors["maxlength"].actualLength;
        return `${fieldLabel} is too long. Maximum ${maxLength} characters allowed (currently ${actualLength}).`;
      }
    }
    return null;
  }

  private getFieldLabel(fieldName: string): string {
    const labels: Record<string, string> = {
      name: 'Character name',
      category: 'Category',
      thumbnail: 'Thumbnail',
      content: 'Content'
    };
    return labels[fieldName] || fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  }

  // Mark field as touched on blur for better validation feedback
  onFieldBlur(fieldName: string): void {
    const field = this.characterForm.get(fieldName);
    if (field) {
      field.markAsTouched();
    }
  }

  onTagCheckboxChange(event: Event, tagId: string): void {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox) {
      this.onTagChange(tagId, checkbox.checked);
    }
  }

  onCategorySelect(categoryId: string): void {
    const categoryControl = this.characterForm.get('category');
    if (categoryControl) {
      categoryControl.setValue(categoryId, { emitEvent: true });
      this.characterForm.markAsDirty();
    }
  }

  getSelectedCategory(): string {
    return this.characterForm.get('category')?.value || '';
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

  /**
   * Highlights required fields that are invalid by adding a highlight class
   */
  private highlightRequiredFields(): void {
    // Add a temporary class to invalid required fields
    // This will be handled via CSS based on the error state
    // The visual highlight is already handled by the .error class
    // We just need to ensure fields are marked as touched
  }

  /**
   * Scrolls to the first invalid required field
   */
  private scrollToFirstInvalidField(): void {
    const requiredFields = ['name', 'category'];
    
    for (const fieldName of requiredFields) {
      const field = this.characterForm.get(fieldName);
      if (field && field.invalid && field.touched) {
        let element: HTMLElement | null = null;
        
        if (fieldName === 'category') {
          // For category, find the form-group container
          element = document.querySelector('.form-group-category') as HTMLElement;
        } else {
          // For other fields, find the input element
          element = document.getElementById(fieldName) || 
                   document.querySelector(`[formControlName="${fieldName}"]`) as HTMLElement;
        }
        
        if (element) {
          // Scroll to the element with some offset from the top
          element.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
          
          // Add a brief highlight animation
          element.classList.add('field-highlight');
          const elementToHighlight = element;
          setTimeout(() => {
            elementToHighlight.classList.remove('field-highlight');
          }, 2000);
          
          // Focus the field if it's an input (not category)
          if (fieldName !== 'category' && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
            const elementToFocus = element;
            setTimeout(() => elementToFocus.focus(), 300);
          }
          
          break; // Only scroll to the first invalid field
        }
      }
    }
  }

  async generateName(): Promise<void> {
    if (!this.aiEnabled) {
      this.error = "AI is not enabled. Please configure AI settings first.";
      return;
    }

    this.isGeneratingName = true;
    this.error = null;

    try {
      // Build context for name generation
      const categoryId = this.characterForm.get("category")?.value;
      const category = this.categories.find((cat) => cat.id === categoryId);
      const selectedTags = this.characterForm.get("tags")?.value || [];
      const tags = this.tags.filter((tag) => selectedTags.includes(tag.id));

      let context = "";
      if (this.currentProject) {
        context += `Project: ${this.currentProject.metadata.projectName}. `;
      }
      if (category) {
        context += `Category: ${category.name}. `;
      }
      if (tags.length > 0) {
        context += `Tags: ${tags.map((t) => t.name).join(", ")}.`;
      }

      const generatedName = await this.aiService.generateCharacterName({
        context,
      });

      if (generatedName) {
        this.characterForm.patchValue({ name: generatedName });
        this.characterForm.markAsDirty();
      }
    } catch (error) {
      this.logger.error("Failed to generate name:", error);
      this.error =
        error instanceof Error ? error.message : "Failed to generate name";
    } finally {
      this.isGeneratingName = false;
    }
  }

  async deleteCharacter(): Promise<void> {
    if (!this.character || !this.isEditing) {
      return;
    }

    const confirmed = await this.modalService.confirm(
      `Are you sure you want to delete "${this.character.name}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await this.characterService.deleteCharacter(this.character.id);
      this.notificationService.showSuccess(`Character "${this.character.name}" deleted successfully`);
      this.router.navigate(["/characters"]);
    } catch (error) {
      this.error = `Failed to delete character: ${error}`;
      this.logger.error("Delete error:", error);
    }
  }
}

