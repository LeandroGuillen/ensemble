import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { Location } from "@angular/common";
import { debounceTime } from "rxjs/operators";
import { merge } from "rxjs";
import {
  Book,
  Category,
  Character,
  CharacterFormData,
  CharacterStyle,
  Project,
  ImageWorkflow,
  ProjectImage,
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
  ImagePickerService,
  MetadataHelperService,
  ProjectService,
} from "../../core/services";
import { ModalService } from "../../core/services/modal.service";
import {
  parseThumbnailReference,
  resolveThumbnailPath,
  resolveThumbnailForStyle,
  formatThumbnailWikiLink,
} from "../../core/utils/thumbnail.utils";
import { normalizeBookCategories } from "../../core/utils/character-category.utils";
import { getBookDisplayName } from "../../core/utils/book-display.utils";
import {
  CategoryToggleComponent,
  ToggleOption,
} from "../../shared/category-toggle/category-toggle.component";
import {
  MultiSelectButtonsComponent,
  SelectableItem,
} from "../../shared/multi-select-buttons/multi-select-buttons.component";
import { PageHeaderComponent } from "../../shared/page-header/page-header.component";
import { ImagePickerDialogComponent } from "../../shared/image-picker-dialog/image-picker-dialog.component";
import { CharacterPromptsEditorComponent } from "./components/character-prompts-editor/character-prompts-editor.component";
import { GeneratePortraitDialogComponent } from "./components/generate-portrait-dialog/generate-portrait-dialog.component";

@Component({
    selector: "app-character-detail",
    imports: [
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    CategoryToggleComponent,
    MultiSelectButtonsComponent,
    PageHeaderComponent,
    ImagePickerDialogComponent,
    CharacterPromptsEditorComponent,
    GeneratePortraitDialogComponent,
],
    templateUrl: "./character-detail.component.html",
    styleUrls: ["./character-detail.component.scss"]
})
export class CharacterDetailComponent
  implements OnInit, OnDestroy, AfterViewInit
{
  @ViewChild("nameInput") nameInput?: ElementRef<HTMLInputElement>;

  private readonly destroyRef = inject(DestroyRef);

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
  /** Per-book category overrides for the form. Key = bookId. */
  bookCategoriesMap: Record<string, string> = {};

  // AI features
  isGeneratingName = false;
  aiEnabled = false;

  // Thumbnail previews by character style
  thumbnailPreviewUrls: Map<string, string> = new Map();
  characterStyles: CharacterStyle[] = [];
  defaultCharacterStyle = '';
  /** Style id the image picker / generate portrait will assign to */
  pickerTargetStyleId = '';
  thumbnailsMap: Record<string, string> = {};
  imageGenerationEnabled = false;
  showGeneratePortraitDialog = false;
  showImagePickerDialog = false;
  private imageWorkflows: ImageWorkflow[] = [];
  private selectedImageWorkflowId = '';

  /** Image-generation prompts for this character. The first one is the default. */
  prompts: CharacterPrompt[] = [];
  /** Set while a quick-generate from a character prompt is in progress. */
  generatingPromptIndex: number | null = null;

  /** True while a text input/textarea in this form has focus — CD is detached to avoid wasted work. */
  private textInputFocused = false;

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
    private imagePickerService: ImagePickerService,
    private metadataHelper: MetadataHelperService,
    private ngZone: NgZone
  ) {
    this.characterForm = this.createForm();
  }

  ngOnInit(): void {
    // Subscribe to project changes
    this.projectService.currentProject$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((project) => {
        this.currentProject = project;
        this.categories = this.projectService.getCategories();
        this.tags = this.projectService.getTags();
        this.books = this.metadataService.getBooks();
        this.characterStyles = this.projectService.getCharacterStyles();
        this.defaultCharacterStyle = this.projectService.getDefaultCharacterStyle();
        if (!this.pickerTargetStyleId) {
          this.pickerTargetStyleId = this.defaultCharacterStyle;
        }
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
          name: this.formatBookLabel(book),
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
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.aiEnabled = settings?.enabled || false;
        this.cdr.markForCheck();
      });

    // Subscribe to route parameter changes (not just snapshot)
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const characterId = params.get("id");
        if (characterId && characterId !== "new") {
          this.isEditing = true;
          this.loadCharacter(decodeURIComponent(characterId));
        } else {
          this.isEditing = false;
          this.character = null;
          const defaultCategory =
            this.categories.find(
              (category) =>
                category.id === this.currentProject?.metadata.settings.defaultCategory
            ) || this.categories[0];
          this.characterForm.reset({
            name: '',
            category: defaultCategory?.id || '',
            tags: [],
            books: [],
            content: '',
          });
          this.thumbnailsMap = {};
          this.thumbnailPreviewUrls = new Map();
          this.prompts = [];
          this.contentTabs = [{ id: 'main', label: 'Main' }];
          this.cdr.markForCheck();
        }
      });

    // Check for query params (e.g., from Backstage)
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params["name"] && !this.isEditing) {
          this.characterForm.patchValue({ name: params["name"] });
          this.cdr.markForCheck();
        }
      });

    // Thumbnail previews are refreshed when thumbnailsMap changes via refreshThumbnailPreviews()

    // Update cached field errors when form value/status changes (debounced to avoid work on every keystroke)
    merge(
      this.characterForm.valueChanges,
      this.characterForm.statusChanges
    )
      .pipe(debounceTime(0), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateFieldErrors();
        this.cdr.markForCheck();
      });

    // Update content tabs when books selection changes
    this.characterForm
      .get("books")
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((bookIds: string[]) => {
        this.pruneBookCategories(bookIds || []);
        this.updateContentTabs();
        this.cdr.markForCheck();
      });

    // Initial field errors (e.g. for create form)
    this.updateFieldErrors();
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownListener);
    this.electronService.setBrowserNavigationInterception(false);
    this.imagePickerService.close();
    if (this.textInputFocused) {
      this.cdr.reattach();
    }
  }

  private keydownListener = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.ngZone.run(() => {
        this.reattachIfDetached();
        if (this.showImagePickerDialog || this.imagePickerService.isOpen) {
          this.closeImagePicker();
          return;
        }
        if (this.showGeneratePortraitDialog) {
          this.showGeneratePortraitDialog = false;
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
          content: this.character.content || '',
        });

        this.thumbnailsMap = { ...(this.character.thumbnails || {}) };
        this.bookCategoriesMap = { ...(this.character.bookCategories || {}) };
        this.pickerTargetStyleId = this.defaultCharacterStyle;
        await this.refreshThumbnailPreviews();

        this.prompts = (this.character.prompts || []).map((p) => ({ ...p }));

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
    return this.metadataHelper.getBookName(bookId);
  }

  private formatBookLabel(book: Book): string {
    return getBookDisplayName(book);
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
    // Name/content use updateOn:'blur', so a value typed into the still-focused
    // field (e.g. submitting with Ctrl+Enter) is pending until blur. Blur it so
    // the pending value is applied before validating.
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    ) {
      active.blur();
    }

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
        bookCategories: normalizeBookCategories(
          this.bookCategoriesMap,
          this.characterForm.value.books || []
        ),
        thumbnails: { ...this.thumbnailsMap },
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

  onBooksSelectionChange(selectedIds: string[]): void {
    this.characterForm.patchValue({ books: selectedIds });
    this.pruneBookCategories(selectedIds);
    this.characterForm.markAsDirty();
  }

  /** Selected books in project metadata order, for the category-by-book UI. */
  getSelectedBooksForCategoryOverrides(): Book[] {
    const selectedIds: string[] = this.characterForm.get('books')?.value || [];
    if (!selectedIds.length) return [];
    const selected = new Set(selectedIds);
    return this.books.filter((book) => selected.has(book.id));
  }

  getBookCategoryOverride(bookId: string): string {
    return this.bookCategoriesMap[bookId] || '';
  }

  onBookCategoryOverrideChange(bookId: string, categoryId: string): void {
    if (!categoryId) {
      delete this.bookCategoriesMap[bookId];
    } else {
      this.bookCategoriesMap[bookId] = categoryId;
    }
    this.characterForm.markAsDirty();
    this.cdr.markForCheck();
  }

  private pruneBookCategories(assignedBookIds: string[]): void {
    const assigned = new Set(assignedBookIds);
    let changed = false;
    for (const bookId of Object.keys(this.bookCategoriesMap)) {
      if (!assigned.has(bookId)) {
        delete this.bookCategoriesMap[bookId];
        changed = true;
      }
    }
    if (changed) {
      this.cdr.markForCheck();
    }
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

  /** Recomputes all field errors and updates cache (used by template via fieldErrors). */
  private updateFieldErrors(): void {
    const fields = ['name', 'category', 'content'];
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
      content: 'Content'
    };
    return labels[fieldName] || fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  }

  get thumbnailPreviewUrl(): string | null {
    return this.getStylePreviewUrl(this.defaultCharacterStyle);
  }

  getStylePreviewUrl(styleId: string): string | null {
    return this.thumbnailPreviewUrls.get(styleId) || null;
  }

  private setThumbnailForStyle(styleId: string, wikiLink: string): void {
    if (!styleId) return;
    const trimmed = wikiLink.trim();
    if (trimmed) {
      this.thumbnailsMap = { ...this.thumbnailsMap, [styleId]: trimmed };
    } else {
      const next = { ...this.thumbnailsMap };
      delete next[styleId];
      this.thumbnailsMap = next;
    }
    this.characterForm.markAsDirty();
    void this.refreshThumbnailPreviews();
  }

  async refreshThumbnailPreviews(): Promise<void> {
    const next = new Map<string, string>();
    if (!this.currentProject?.path) {
      this.thumbnailPreviewUrls = next;
      this.cdr.markForCheck();
      return;
    }
    await Promise.all(
      this.characterStyles.map(async (style) => {
        const raw = resolveThumbnailForStyle(this.thumbnailsMap, style.id);
        if (!raw) return;
        const parsed = parseThumbnailReference(raw);
        if (!parsed) return;
        try {
          const dataUrl = await this.electronService.getImageAsDataUrl(
            resolveThumbnailPath(this.currentProject!.path, parsed)
          );
          if (dataUrl) {
            next.set(style.id, dataUrl);
          }
        } catch {
          // Ignore missing files
        }
      })
    );
    this.thumbnailPreviewUrls = next;
    this.cdr.markForCheck();
  }

  /**
   * Detach CD while a text input is focused. Since name/content use updateOn:'blur',
   * form values don't change during typing — running CD on every keystroke is wasted work
   * (~114ms per key in production, ~190ms in dev mode).
   */
  onTextInputFocus(_event: FocusEvent): void {
    this.textInputFocused = true;
    this.cdr.detach();
  }

  onTextInputBlur(fieldName: string): void {
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

  openGeneratePortrait(): void {
    if (!this.imageGenerationEnabled) {
      this.error = 'Image generation is not enabled. Configure it in AI Settings first.';
      this.cdr.markForCheck();
      return;
    }
    this.pickerTargetStyleId = this.defaultCharacterStyle || this.characterStyles[0]?.id || '';
    this.error = null;
    this.showGeneratePortraitDialog = true;
    this.cdr.markForCheck();
  }

  onPortraitGenerated(relativePath: string): void {
    this.setThumbnailForStyle(
      this.pickerTargetStyleId || this.defaultCharacterStyle,
      formatThumbnailWikiLink(relativePath)
    );
    this.showGeneratePortraitDialog = false;
    this.notificationService.showSuccess(`Portrait saved to ${relativePath}`);
    this.cdr.markForCheck();
  }

  async openImagePicker(styleId?: string): Promise<void> {
    this.pickerTargetStyleId = styleId || this.defaultCharacterStyle || this.characterStyles[0]?.id || '';
    this.showImagePickerDialog = true;
    this.cdr.markForCheck();
    await this.imagePickerService.open({
      thumbnailHint: resolveThumbnailForStyle(this.thumbnailsMap, this.pickerTargetStyleId) || '',
      imagesFolder: this.currentProject?.metadata?.settings?.imagesFolder,
    });
    const loadError = this.imagePickerService.snapshot.error;
    if (loadError) {
      this.error = loadError;
      this.cdr.markForCheck();
    }
  }

  closeImagePicker(): void {
    this.imagePickerService.close();
    this.showImagePickerDialog = false;
    this.cdr.markForCheck();
  }

  onImageSelected(image: ProjectImage): void {
    const styleId = this.pickerTargetStyleId || this.defaultCharacterStyle;
    this.setThumbnailForStyle(styleId, formatThumbnailWikiLink(image.relativePath));
    this.showImagePickerDialog = false;
    this.cdr.markForCheck();
  }

  onImagePickerExplorerError(message: string): void {
    this.error = message;
    this.cdr.markForCheck();
  }

  handlePickerNavigationAway(): boolean {
    return this.imagePickerService.handleNavigationAway();
  }

  removeThumbnail(styleId?: string): void {
    const target = styleId || this.defaultCharacterStyle;
    if (!resolveThumbnailForStyle(this.thumbnailsMap, target)) return;
    this.setThumbnailForStyle(target, '');
  }

  hasThumbnailForStyle(styleId: string): boolean {
    return !!resolveThumbnailForStyle(this.thumbnailsMap, styleId);
  }

  get thumbnailOutputDirectory(): string | null {
    return this.getThumbnailOutputDirectory();
  }

  onPromptsChange(prompts: CharacterPrompt[]): void {
    this.prompts = prompts;
  }

  onPromptsDirty(): void {
    this.characterForm.markAsDirty();
    this.cdr.markForCheck();
  }

  async generateFromPrompt(prompt: CharacterPrompt): Promise<void> {
    if (!this.imageGenerationEnabled || !prompt.positive.trim()) return;
    if (this.generatingPromptIndex !== null) return;
    this.generatingPromptIndex = this.prompts.indexOf(prompt);
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
      this.setThumbnailForStyle(
        this.defaultCharacterStyle,
        formatThumbnailWikiLink(relativePath)
      );
      this.notificationService.showSuccess(`Image saved to ${relativePath}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to generate image';
    } finally {
      this.generatingPromptIndex = null;
      this.cdr.markForCheck();
    }
  }

  private async resolveDefaultWorkflowId(): Promise<string> {
    if (this.selectedImageWorkflowId) {
      return this.selectedImageWorkflowId;
    }
    const configured = this.imageGenerationService.getDefaultWorkflowId();
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

  private getThumbnailOutputDirectory(): string | null {
    const styleId = this.pickerTargetStyleId || this.defaultCharacterStyle;
    const raw = resolveThumbnailForStyle(this.thumbnailsMap, styleId) || '';
    const parsed = parseThumbnailReference(raw);
    if (!parsed) return null;
    const normalized = parsed.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.slice(0, lastSlash) : null;
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
