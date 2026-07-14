
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { Location } from "@angular/common";
import { Subject } from "rxjs";
import { debounceTime, takeUntil } from "rxjs/operators";
import { merge } from "rxjs";
import {
  Book,
  Category,
  Character,
  CharacterFormData,
  Project,
  ImageWorkflow,
  ProjectImage,
  ProjectImageDirectory,
  ProjectImageFolder,
  Tag,
  CharacterPrompt,
} from "../../core/interfaces";
import {
  AiService,
  CharacterService,
  ElectronService,
  LoggingService,
  MetadataService,
  NotificationService,
  ImageGenerationService,
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
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";
@Component({
    selector: "app-character-detail",
    imports: [
    FormsModule,
    ReactiveFormsModule,
    CategoryToggleComponent,
    MultiSelectButtonsComponent,
    PageHeaderComponent,
],
    templateUrl: "./character-detail.component.html",
    styleUrls: ["./character-detail.component.scss"]
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

  /** Cached content tabs (Main + book pages) — updated when character or books change. */
  contentTabs: { id: string; label: string }[] = [];
  /** Cached category options for the toggle — updated when categories change. */
  categoryToggleOptions: ToggleOption[] = [];
  /** Cached field errors — updated on form changes (debounced) and on blur. */
  fieldErrors: Record<string, string | null> = {};

  isEditing = false;
  isLoading = false;
  activeTab: 'basic' = 'basic';
  /** 'main' or bookId; which content tab is active */
  activeContentTab: 'main' | string = 'main';
  isSaving = false;
  /** When saving a book page, the bookId being saved */
  savingBookPageId: string | null = null;
  error: string | null = null;

  /** Book page state: exists (file on disk) and content. Key = bookId. */
  bookPageData: Record<string, { exists: boolean; content: string }> = {};
  /** Last saved content per book (for dirty check). Key = bookId. */
  bookPageOriginalContent: Record<string, string> = {};

  // AI features
  isGeneratingName = false;
  aiEnabled = false;

  // Thumbnail preview (resolved from img/ path)
  thumbnailPreviewUrl: string | null = null;
  imageGenerationEnabled = false;
  showGeneratePortraitDialog = false;
  showImagePickerDialog = false;
  imageWorkflows: ImageWorkflow[] = [];
  selectedImageWorkflowId = '';
  positiveImagePrompt = '';
  negativeImagePrompt = '';
  isGeneratingPortrait = false;

  /** Image-generation prompts for this character. The first one is the default. */
  prompts: CharacterPrompt[] = [];
  /** Index of the prompt currently being edited. */
  selectedPromptIndex = 0;
  /** Set while a quick-generate from a character prompt is in progress. */
  generatingPromptIndex: number | null = null;

  get selectedImageWorkflow(): ImageWorkflow | undefined {
    return this.imageWorkflows.find((workflow) => workflow.id === this.selectedImageWorkflowId);
  }

  isLoadingImages = false;
  projectImages: ProjectImage[] = [];
  imageDirectories: ProjectImageFolder[] = [];
  currentImageDirectory = '';
  imageSearch = '';
  private imagePickerHistory: string[] = [];
  private imagePickerHistoryIndex = -1;
  private imageDirectoryCache = new Map<string, ProjectImageDirectory>();
  private lastExternalPickerNavigation: {
    direction: 'back' | 'forward';
    timestamp: number;
  } | null = null;
  private browserNavigationCommandListener = (
    _event: unknown,
    direction: 'back' | 'forward'
  ) => {
    if (!this.showImagePickerDialog) return;
    this.ngZone.run(() => {
      this.handleExternalPickerNavigation(direction);
    });
  };

  /** True while a text input/textarea in this form has focus — CD is detached to avoid wasted work. */
  private textInputFocused = false;
  private focusedElement: HTMLElement | null = null;
  /**
   * Stops input/beforeinput events from bubbling into zone.js while a text field is focused.
   * Registered in the capture phase on the focused element so it fires before zone's listener.
   */
  private inputEventStopper = (e: Event) => e.stopPropagation();

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
    private notificationService: NotificationService,
    private imageGenerationService: ImageGenerationService,
    private ngZone: NgZone
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
        this.imageGenerationEnabled =
          project?.metadata.settings.imageGeneration?.enabled || false;

        // Update cached category options (avoids creating new array on every CD)
        this.categoryToggleOptions = this.categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          tooltip: cat.description || cat.name,
        }));

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
        this.cdr.markForCheck();
      });

    // Subscribe to AI settings
    this.aiService
      .getAiSettings()
      .pipe(takeUntil(this.destroy$))
      .subscribe((settings) => {
        this.aiEnabled = settings?.enabled || false;
        this.cdr.markForCheck();
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
          this.prompts = [];
          this.selectedPromptIndex = -1;
          this.contentTabs = [{ id: 'main', label: 'Main' }];
          this.cdr.markForCheck();
        }
      });

    // Check for query params (e.g., from Backstage)
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        if (params["name"] && !this.isEditing) {
          this.characterForm.patchValue({ name: params["name"] });
          this.cdr.markForCheck();
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

    // Update cached field errors when form value/status changes (debounced to avoid work on every keystroke)
    merge(
      this.characterForm.valueChanges,
      this.characterForm.statusChanges
    )
      .pipe(debounceTime(0), takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateFieldErrors();
        this.cdr.markForCheck();
      });

    // Update content tabs when books selection changes
    this.characterForm
      .get("books")
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateContentTabs();
        this.cdr.markForCheck();
      });

    // Initial field errors (e.g. for create form)
    this.updateFieldErrors();
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownListener);
    this.electronService.setBrowserNavigationInterception(false);
    this.electronService.removeBrowserNavigationCommandListener(
      this.browserNavigationCommandListener
    );
    if (this.focusedElement) {
      this.focusedElement.removeEventListener('input', this.inputEventStopper, true);
      this.focusedElement.removeEventListener('beforeinput', this.inputEventStopper, true);
      this.focusedElement = null;
    }
    if (this.textInputFocused) {
      this.cdr.reattach();
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  private keydownListener = (event: KeyboardEvent) => {
    if (
      this.showImagePickerDialog &&
      event.altKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      this.ngZone.run(() => {
        event.key === 'ArrowLeft'
          ? this.goBackInImagePicker()
          : this.goForwardInImagePicker();
      });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.ngZone.run(() => {
        this.reattachIfDetached();
        if (this.showImagePickerDialog) {
          this.closeImagePicker();
          return;
        }
        if (this.showGeneratePortraitDialog) {
          this.closeGeneratePortrait();
          return;
        }
        this.onCancel();
      });
      return;
    }
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      this.ngZone.run(() => {
        this.reattachIfDetached();
        if (this.activeContentTab === 'main') {
          this.onSubmit();
        } else if (this.activeContentTab && this.character) {
          this.onSaveBookPage(this.activeContentTab);
        }
      });
      return;
    }
    // All other keys: do nothing and DON'T enter zone — avoids CD on every keystroke
  };

  ngAfterViewInit(): void {
    // Focus the name input after view is initialized
    setTimeout(() => {
      this.nameInput?.nativeElement.focus();
    }, 0);

    // Register keydown outside zone so regular typing doesn't trigger CD
    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.keydownListener);
    });
    this.electronService.onBrowserNavigationCommand(
      this.browserNavigationCommandListener
    );
  }

  private reattachIfDetached(): void {
    if (this.textInputFocused) {
      this.textInputFocused = false;
      this.cdr.reattach();
      this.cdr.detectChanges();
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
        this.cdr.markForCheck();
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

        this.prompts = (this.character.prompts || []).map((p) => ({ ...p }));
        this.selectedPromptIndex = this.prompts.length > 0 ? 0 : -1;

        this.activeContentTab = 'main';
        this.updateContentTabs();
        await this.loadBookPages();
      } else {
        this.error = "Character not found";
      }
    } catch (error) {
      this.error = `Failed to load character: ${error}`;
      this.logger.error("Load character error:", error);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private async loadBookPages(): Promise<void> {
    if (!this.character) return;
    this.bookPageData = {};
    this.bookPageOriginalContent = {};
    const bookIds = this.character.books || [];
    for (const bookId of bookIds) {
      const content = await this.characterService.getBookPageContent(
        this.character.id,
        bookId
      );
      const exists = content !== null;
      const text = content ?? '';
      this.bookPageData[bookId] = { exists, content: text };
      this.bookPageOriginalContent[bookId] = text;
    }
    this.cdr.markForCheck();
  }

  /** Ensure book page state is loaded for a book (e.g. when user adds book to character). */
  async ensureBookPageData(bookId: string): Promise<void> {
    if (this.bookPageData[bookId] !== undefined) return;
    if (!this.character) return;
    const content = await this.characterService.getBookPageContent(
      this.character.id,
      bookId
    );
    const exists = content !== null;
    const text = content ?? '';
    this.bookPageData[bookId] = { exists, content: text };
    this.bookPageOriginalContent[bookId] = text;
    this.cdr.markForCheck();
  }

  /** Updates cached contentTabs (call when character or books form value changes). */
  private updateContentTabs(): void {
    const tabs: { id: string; label: string }[] = [{ id: 'main', label: 'Main' }];
    if (this.character) {
      const bookIds = this.characterForm.get('books')?.value ?? this.character.books ?? [];
      for (const bookId of bookIds) {
        tabs.push({ id: bookId, label: this.getBookName(bookId) });
      }
    }
    this.contentTabs = tabs;
  }

  getBookName(bookId: string): string {
    const book = this.books.find((b) => b.id === bookId);
    return book?.name ?? bookId;
  }

  getBookPageContent(bookId: string): string {
    const data = this.bookPageData[bookId];
    return data?.content ?? '';
  }

  setBookPageContent(bookId: string, content: string): void {
    const data = this.bookPageData[bookId];
    if (data) {
      data.content = content;
    }
  }

  setActiveContentTab(tabId: string): void {
    this.activeContentTab = tabId;
    if (tabId !== 'main') {
      this.ensureBookPageData(tabId);
    }
  }

  isBookPageDirty(bookId: string): boolean {
    const data = this.bookPageData[bookId];
    const original = this.bookPageOriginalContent[bookId] ?? '';
    return data ? data.content !== original : false;
  }

  hasAnyBookPageDirty(): boolean {
    return Object.keys(this.bookPageData).some((id) => this.isBookPageDirty(id));
  }

  async onCreateBookPage(bookId: string): Promise<void> {
    if (!this.character) return;
    this.savingBookPageId = bookId;
    this.error = null;
    try {
      await this.characterService.createBookPage(this.character.id, bookId);
      this.bookPageData[bookId] = { exists: true, content: '' };
      this.bookPageOriginalContent[bookId] = '';
      this.activeContentTab = bookId;
      this.notificationService.showSuccess('Book page created');
      this.cdr.markForCheck();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to create book page';
      this.cdr.markForCheck();
    } finally {
      this.savingBookPageId = null;
      this.cdr.markForCheck();
    }
  }

  async onSaveBookPage(bookId: string): Promise<void> {
    if (!this.character) return;
    this.savingBookPageId = bookId;
    this.error = null;
    try {
      const data = this.bookPageData[bookId];
      const content = data?.content ?? '';
      await this.characterService.saveBookPage(this.character.id, bookId, content);
      this.bookPageOriginalContent[bookId] = content;
      this.notificationService.showSuccess('Character saved successfully');
      this.router.navigate(['/characters']);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save book page';
      this.cdr.markForCheck();
    } finally {
      this.savingBookPageId = null;
      this.cdr.markForCheck();
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
      this.cdr.markForCheck();
      return;
    }

    this.isSaving = true;
    this.error = null;
    this.cdr.markForCheck();

    try {
      const formData: CharacterFormData = {
        name: this.characterForm.value.name,
        category: this.characterForm.value.category,
        tags: this.characterForm.value.tags || [],
        books: this.characterForm.value.books || [],
        thumbnail: (this.characterForm.value.thumbnail || '').trim(),
        prompts: this.prompts.map((p) => ({
          name: p.name,
          positive: p.positive,
          negative: p.negative,
        })),
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
      this.cdr.markForCheck();
    } finally {
      this.isSaving = false;
      this.cdr.markForCheck();
    }
  }

  async onCancel(): Promise<void> {
    const mainDirty = this.characterForm.dirty;
    const bookDirty = this.hasAnyBookPageDirty();
    if (mainDirty || bookDirty) {
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
    const isFromApp = referrer && (
      referrer.startsWith(currentOrigin) ||
      referrer.includes('localhost:4200') ||
      referrer.startsWith('file://')
    );
    if (isFromApp && window.history.length > 1) {
      this.location.back();
    } else {
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

  /** Recomputes all field errors and updates cache (used by template via fieldErrors). */
  private updateFieldErrors(): void {
    const fields = ['name', 'category', 'thumbnail', 'content'];
    for (const name of fields) {
      this.fieldErrors[name] = this.computeFieldError(name);
    }
  }

  getFieldError(fieldName: string): string | null {
    return this.fieldErrors[fieldName] ?? this.computeFieldError(fieldName);
  }

  private computeFieldError(fieldName: string): string | null {
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

  /**
   * Detach CD while a text input is focused. Since name/content use updateOn:'blur',
   * form values don't change during typing — running CD on every keystroke is wasted work
   * (~114ms per key in production, ~190ms in dev mode).
   */
  onTextInputFocus(event: FocusEvent): void {
    this.textInputFocused = true;
    this.cdr.detach();

    // Prevent input events from reaching zone.js while this field is focused.
    // With updateOn:'blur', the form value doesn't change during typing,
    // so input events inside zone are pure waste.
    const el = event.target as HTMLElement;
    this.focusedElement = el;
    this.ngZone.runOutsideAngular(() => {
      el.addEventListener('input', this.inputEventStopper, true);
      el.addEventListener('beforeinput', this.inputEventStopper, true);
    });
  }

  onTextInputBlur(fieldName: string): void {
    if (this.focusedElement) {
      this.focusedElement.removeEventListener('input', this.inputEventStopper, true);
      this.focusedElement.removeEventListener('beforeinput', this.inputEventStopper, true);
      this.focusedElement = null;
    }
    this.textInputFocused = false;
    this.cdr.reattach();
    this.onFieldBlur(fieldName);
    this.cdr.detectChanges();
  }

  // Mark field as touched on blur for better validation feedback
  onFieldBlur(fieldName: string): void {
    const field = this.characterForm.get(fieldName);
    if (field) {
      field.markAsTouched();
      this.fieldErrors[fieldName] = this.computeFieldError(fieldName);
      this.cdr.markForCheck();
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
      this.cdr.markForCheck();
      return;
    }

    this.isGeneratingName = true;
    this.error = null;
    this.cdr.markForCheck();

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
        this.cdr.markForCheck();
      }
    } catch (error) {
      this.logger.error("Failed to generate name:", error);
      this.error =
        error instanceof Error ? error.message : "Failed to generate name";
      this.cdr.markForCheck();
    } finally {
      this.isGeneratingName = false;
      this.cdr.markForCheck();
    }
  }

  async openGeneratePortrait(): Promise<void> {
    if (!this.imageGenerationEnabled) {
      this.error = 'Image generation is not enabled. Configure it in AI Settings first.';
      return;
    }
    this.error = null;
    this.showGeneratePortraitDialog = true;
    try {
      this.imageWorkflows = await this.imageGenerationService.listWorkflows();
      const configured = this.imageGenerationService.getSettings().invokeai.defaultWorkflowId;
      this.selectedImageWorkflowId =
        (configured && this.imageWorkflows.some((workflow) => workflow.id === configured)
          ? configured
          : this.imageWorkflows[0]?.id) || '';
    } catch (error) {
      this.showGeneratePortraitDialog = false;
      this.error = error instanceof Error ? error.message : 'Failed to load image workflows';
    }
    this.cdr.markForCheck();
  }

  closeGeneratePortrait(): void {
    if (!this.isGeneratingPortrait) {
      this.showGeneratePortraitDialog = false;
    }
  }

  async generatePortrait(): Promise<void> {
    if (!this.selectedImageWorkflowId || !this.positiveImagePrompt.trim()) return;
    const characterName = this.characterForm.get('name')?.value?.trim() || 'character';
    this.isGeneratingPortrait = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      const relativePath = await this.imageGenerationService.generateAndSave({
        workflowId: this.selectedImageWorkflowId,
        positivePrompt: this.positiveImagePrompt.trim(),
        negativePrompt: this.negativeImagePrompt.trim(),
        characterName,
      });
      this.characterForm.patchValue({ thumbnail: `[[${relativePath}]]` });
      this.characterForm.markAsDirty();
      this.showGeneratePortraitDialog = false;
      this.notificationService.showSuccess(`Portrait saved to ${relativePath}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to generate portrait';
    } finally {
      this.isGeneratingPortrait = false;
      this.cdr.markForCheck();
    }
  }

  async openImagePicker(): Promise<void> {
    this.showImagePickerDialog = true;
    this.electronService.setBrowserNavigationInterception(true);
    this.imageSearch = '';
    this.projectImages = [];
    this.imageDirectories = [];
    this.currentImageDirectory = '';
    this.imageDirectoryCache.clear();
    this.imagePickerHistory = [];
    this.imagePickerHistoryIndex = -1;
    this.lastExternalPickerNavigation = null;
    this.cdr.markForCheck();
    const initialDirectory = this.getInitialImagePickerDirectory();
    let loaded = await this.loadImageDirectory(initialDirectory, false);
    if (!loaded && initialDirectory) {
      this.error = null;
      loaded = await this.loadImageDirectory('', false);
    }
    if (loaded && this.showImagePickerDialog) {
      this.initializeImagePickerHistory(this.currentImageDirectory);
    }
  }

  async loadImageDirectory(relativeDirectory: string, addToHistory = false): Promise<boolean> {
    const cachedListing = this.imageDirectoryCache.get(relativeDirectory);
    if (cachedListing) {
      this.applyImageDirectory(cachedListing);
      if (addToHistory) {
        this.recordImagePickerHistory(cachedListing.relativeDirectory);
      }
      this.cdr.markForCheck();
      return true;
    }

    this.isLoadingImages = true;
    this.imageSearch = '';
    this.cdr.markForCheck();
    try {
      const listing =
        await this.imageGenerationService.browseProjectImageDirectory(relativeDirectory);
      this.imageDirectoryCache.set(listing.relativeDirectory, listing);
      this.applyImageDirectory(listing);
      if (addToHistory) {
        this.recordImagePickerHistory(listing.relativeDirectory);
      }
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load project images';
      return false;
    } finally {
      this.isLoadingImages = false;
      this.cdr.markForCheck();
    }
  }

  private getInitialImagePickerDirectory(): string {
    const thumbnail = parseThumbnailReference(
      this.characterForm.get('thumbnail')?.value || ''
    );
    if (!thumbnail) return '';

    const imagesFolder = (
      this.currentProject?.metadata?.settings?.imagesFolder?.trim() || 'img'
    )
      .replace(/\\/g, '/')
      .replace(/^\.?\/+|\/+$/g, '');
    const thumbnailPath = thumbnail
      .replace(/\\/g, '/')
      .replace(/^\.?\/+/, '');
    const prefix = `${imagesFolder}/`;
    if (!thumbnailPath.startsWith(prefix)) return '';

    const parts = thumbnailPath.slice(prefix.length).split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  private applyImageDirectory(listing: ProjectImageDirectory): void {
    this.imageSearch = '';
    this.currentImageDirectory = listing.relativeDirectory;
    this.imageDirectories = listing.directories;
    this.projectImages = listing.images;
  }

  openImageDirectory(name: string): void {
    const path = this.currentImageDirectory
      ? `${this.currentImageDirectory}/${name}`
      : name;
    void this.loadImageDirectory(path, true);
  }

  goToParentImageDirectory(): void {
    const parts = this.currentImageDirectory.split('/').filter(Boolean);
    parts.pop();
    void this.loadImageDirectory(parts.join('/'), true);
  }

  navigateImageDirectory(path: string): void {
    if (path !== this.currentImageDirectory) {
      void this.loadImageDirectory(path, true);
    }
  }

  get canGoBackInImagePicker(): boolean {
    return this.showImagePickerDialog && this.imagePickerHistoryIndex >= 0;
  }

  get canGoForwardInImagePicker(): boolean {
    return this.imagePickerHistoryIndex < this.imagePickerHistory.length - 1;
  }

  goBackInImagePicker(): void {
    if (this.imagePickerHistoryIndex <= 0) {
      this.closeImagePicker();
      return;
    }
    void this.restoreImagePickerHistory(this.imagePickerHistoryIndex - 1);
  }

  goForwardInImagePicker(): void {
    void this.restoreImagePickerHistory(this.imagePickerHistoryIndex + 1);
  }

  closeImagePicker(): void {
    this.showImagePickerDialog = false;
    this.electronService.setBrowserNavigationInterception(false);
    this.cdr.markForCheck();
  }

  /** Opens the directory currently shown in the image picker in the OS file explorer. */
  async openCurrentImageDirectoryInExplorer(): Promise<void> {
    if (!this.currentProject?.path || !this.electronService.isElectron()) return;
    const imagesRoot = this.projectService.getImagesFolderPath();
    const absolutePath = this.currentImageDirectory
      ? await this.electronService.pathJoin(imagesRoot, ...this.currentImageDirectory.split('/'))
      : imagesRoot;
    const result = await this.electronService.openPath(absolutePath);
    if (!result.success) {
      this.error = result.error ?? 'Failed to open folder';
      this.cdr.markForCheck();
    }
  }

  handlePickerNavigationAway(): boolean {
    if (this.showImagePickerDialog) {
      this.handleExternalPickerNavigation('back');
      return false;
    }
    return !(
      this.lastExternalPickerNavigation?.direction === 'back' &&
      Date.now() - this.lastExternalPickerNavigation.timestamp < 300
    );
  }

  private handleExternalPickerNavigation(direction: 'back' | 'forward'): void {
    const timestamp = Date.now();
    if (
      this.lastExternalPickerNavigation?.direction === direction &&
      timestamp - this.lastExternalPickerNavigation.timestamp < 300
    ) {
      return;
    }
    this.lastExternalPickerNavigation = { direction, timestamp };
    direction === 'back'
      ? this.goBackInImagePicker()
      : this.goForwardInImagePicker();
  }

  private recordImagePickerHistory(path: string): void {
    this.imagePickerHistory = this.imagePickerHistory.slice(
      0,
      this.imagePickerHistoryIndex + 1
    );
    this.imagePickerHistory.push(path);
    this.imagePickerHistoryIndex = this.imagePickerHistory.length - 1;
  }

  private initializeImagePickerHistory(path: string): void {
    this.imagePickerHistory = [path];
    this.imagePickerHistoryIndex = 0;
  }

  private async restoreImagePickerHistory(index: number): Promise<void> {
    if (index < 0 || index >= this.imagePickerHistory.length || this.isLoadingImages) return;
    const path = this.imagePickerHistory[index];
    const listing = this.imageDirectoryCache.get(path);
    if (listing) {
      this.imagePickerHistoryIndex = index;
      this.applyImageDirectory(listing);
      this.cdr.markForCheck();
      return;
    }
    if (await this.loadImageDirectory(path, false)) {
      this.imagePickerHistoryIndex = index;
    }
  }

  get imageBreadcrumbs(): Array<{ label: string; path: string }> {
    const parts = this.currentImageDirectory.split('/').filter(Boolean);
    return parts.map((label, index) => ({
      label,
      path: parts.slice(0, index + 1).join('/'),
    }));
  }

  get filteredProjectImages(): ProjectImage[] {
    const query = this.imageSearch.trim().toLowerCase();
    return query
      ? this.projectImages.filter((image) => image.relativePath.toLowerCase().includes(query))
      : this.projectImages;
  }

  get filteredImageDirectories(): ProjectImageFolder[] {
    const query = this.imageSearch.trim().toLowerCase();
    return query
      ? this.imageDirectories.filter((directory) => directory.name.toLowerCase().includes(query))
      : this.imageDirectories;
  }

  selectProjectImage(image: ProjectImage): void {
    this.characterForm.patchValue({ thumbnail: `[[${image.relativePath}]]` });
    this.characterForm.markAsDirty();
    this.closeImagePicker();
  }

  removeThumbnail(): void {
    if (!this.characterForm.get('thumbnail')?.value?.trim()) return;
    this.characterForm.patchValue({ thumbnail: '' });
    this.characterForm.markAsDirty();
    this.thumbnailPreviewUrl = null;
    this.cdr.markForCheck();
  }

  // --- Prompts ---------------------------------------------------------------

  /** Display label for a prompt entry (falls back to "Prompt N"). */
  getPromptLabel(prompt: CharacterPrompt, index: number): string {
    return prompt.name?.trim() || `Prompt ${index + 1}`;
  }

  /** The prompt currently selected for editing, or null. */
  get selectedPrompt(): CharacterPrompt | null {
    if (this.selectedPromptIndex < 0 || this.selectedPromptIndex >= this.prompts.length) {
      return null;
    }
    return this.prompts[this.selectedPromptIndex];
  }

  selectPrompt(index: number): void {
    if (index >= 0 && index < this.prompts.length) {
      this.selectedPromptIndex = index;
      this.cdr.markForCheck();
    }
  }

  addPrompt(): void {
    const newPrompt: CharacterPrompt = { name: '', positive: '', negative: '' };
    this.prompts = [...this.prompts, newPrompt];
    this.selectedPromptIndex = this.prompts.length - 1;
    this.characterForm.markAsDirty();
    this.cdr.markForCheck();
  }

  removePrompt(index: number): void {
    if (index < 0 || index >= this.prompts.length) return;
    this.prompts = this.prompts.filter((_, i) => i !== index);
    if (this.prompts.length === 0) {
      this.selectedPromptIndex = -1;
    } else if (this.selectedPromptIndex >= this.prompts.length) {
      this.selectedPromptIndex = this.prompts.length - 1;
    }
    this.characterForm.markAsDirty();
    this.cdr.markForCheck();
  }

  /** Promotes a prompt to position 0, making it the default. No-op if already first. */
  setPromptAsDefault(index: number): void {
    if (index <= 0 || index >= this.prompts.length) return;
    const next = [...this.prompts];
    const [item] = next.splice(index, 1);
    next.unshift(item);
    this.prompts = next;
    this.selectedPromptIndex = this.selectedPromptIndex === index ? 0 : this.selectedPromptIndex;
    this.characterForm.markAsDirty();
    this.cdr.markForCheck();
  }

  onPromptFieldChange(): void {
    this.characterForm.markAsDirty();
    this.cdr.markForCheck();
  }

  /** True when the prompt-clear generate action is unavailable. */
  get promptGenerateDisabled(): boolean {
    return (
      !this.imageGenerationEnabled ||
      this.generatingPromptIndex !== null ||
      !this.selectedPrompt ||
      !this.selectedPrompt.positive.trim()
    );
  }

  /** Title text for the prompt-generate button, explaining why it may be disabled. */
  get promptGenerateTitle(): string {
    if (!this.imageGenerationEnabled) {
      return 'Enable image generation in AI Settings to generate from this prompt';
    }
    if (!this.selectedPrompt || !this.selectedPrompt.positive.trim()) {
      return 'Enter positive text to enable generation';
    }
    const dir = this.getThumbnailOutputDirectory();
    return dir
      ? `Generate with this prompt and save beside the current thumbnail (${dir})`
      : 'Generate with this prompt';
  }

  /**
   * Quick-generates an image using the selected character prompt and the default
   * workflow. The image is saved into the same folder as the current thumbnail
   * (when one is set) and becomes the new thumbnail.
   */
  async generateFromPrompt(prompt: CharacterPrompt): Promise<void> {
    if (!this.imageGenerationEnabled || !prompt.positive.trim()) return;
    if (this.generatingPromptIndex !== null) return;
    this.generatingPromptIndex = this.selectedPromptIndex;
    this.error = null;
    this.cdr.markForCheck();
    try {
      const workflowId = await this.resolveDefaultWorkflowId();
      if (!workflowId) {
        throw new Error('No image workflows configured');
      }
      const characterName =
        this.characterForm.get('name')?.value?.trim() || 'character';
      const outputDirectory = this.getThumbnailOutputDirectory();
      const relativePath = await this.imageGenerationService.generateAndSave({
        workflowId,
        positivePrompt: prompt.positive.trim(),
        negativePrompt: prompt.negative.trim(),
        characterName,
        ...(outputDirectory ? { outputDirectory } : {}),
      });
      this.characterForm.patchValue({ thumbnail: `[[${relativePath}]]` });
      this.characterForm.markAsDirty();
      this.notificationService.showSuccess(`Image saved to ${relativePath}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to generate image';
    } finally {
      this.generatingPromptIndex = null;
      this.cdr.markForCheck();
    }
  }

  /**
   * Resolves the workflow id to use for quick generation: the configured default
   * if available, otherwise the first workflow (loaded on demand).
   */
  private async resolveDefaultWorkflowId(): Promise<string> {
    if (this.selectedImageWorkflowId) {
      return this.selectedImageWorkflowId;
    }
    const configured = this.imageGenerationService.getSettings().invokeai.defaultWorkflowId;
    const workflows = this.imageWorkflows.length
      ? this.imageWorkflows
      : (this.imageWorkflows = await this.imageGenerationService.listWorkflows());
    const id =
      (configured && workflows.some((w) => w.id === configured)
        ? configured
        : workflows[0]?.id) || '';
    this.selectedImageWorkflowId = id;
    return id;
  }

  /**
   * Returns the project-relative directory containing the current thumbnail, or
   * null when no thumbnail is set.
   */
  private getThumbnailOutputDirectory(): string | null {
    const raw = this.characterForm.get('thumbnail')?.value || '';
    const parsed = parseThumbnailReference(raw);
    if (!parsed) return null;
    const normalized = parsed.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.slice(0, lastSlash) : null;
  }

  getProjectImageName(image: ProjectImage): string {
    return image.relativePath.split('/').pop() || image.relativePath;
  }

  /** Open the folder containing the character file in the system file manager. */
  async openCharacterFolder(): Promise<void> {
    if (!this.character?.filePath || !this.electronService.isElectron()) return;
    await this.electronService.showItemInFolder(this.character.filePath);
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
      this.cdr.markForCheck();
    }
  }
}

