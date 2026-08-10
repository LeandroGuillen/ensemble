
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnInit, ViewChild, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { Book, Cast, Category, Character, CharacterStyle, Project, Tag } from '../../core/interfaces';
import { CharacterService, ElectronService, MetadataService, NotificationService, ProjectService, LoggingService, CharacterEditDialogService } from '../../core/services';
import { MetadataHelperService } from '../../core/services/metadata-helper.service';
import { ModalService } from '../../core/services/modal.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { resolveThumbnailForStyle } from '../../core/utils/thumbnail.utils';
import { resolveEffectiveCategory } from '../../core/utils/character-category.utils';
import { contrastTextColor } from '../../core/utils/color-contrast.utils';
import { ToggleOption } from '../../shared/category-toggle/category-toggle.component';
import { CharacterFilterComponent } from '../../shared/character-filter/character-filter.component';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';
import { SelectableItem } from '../../shared/multi-select-buttons/multi-select-buttons.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import {
  CharacterCompactViewComponent,
  CharacterGalleryViewComponent,
  CharacterGridViewComponent,
  CharacterListViewComponent,
} from './views';
@Component({
    selector: 'app-character-list',
    imports: [
    DragDropModule,
    FormsModule,
    PageHeaderComponent,
    CharacterFilterComponent,
    CharacterGridViewComponent,
    CharacterListViewComponent,
    CharacterCompactViewComponent,
    CharacterGalleryViewComponent
],
    templateUrl: './character-list.component.html',
    styleUrls: ['./character-list.component.scss'],
    animations: [
      trigger('characterFiltersSidebar', [
        state('open', style({ width: '260px' })),
        state('closed', style({ width: '0', overflow: 'hidden' })),
        transition('open <=> closed', [
          animate('240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'),
        ]),
      ]),
    ]
})
export class CharacterListComponent implements OnInit {
  @ViewChild('scrollableContent', { static: false })
  private scrollableContentRef: ElementRef<HTMLDivElement> | null = null;

  private readonly dragAutoScrollThresholdPx = 120;
  private readonly dragAutoScrollMaxStepPx = 18;

  private readonly destroyRef = inject(DestroyRef);

  characters$: Observable<Character[]>;
  categories: Category[] = [];
  tags: Tag[] = [];
  casts: Cast[] = [];
  books: Book[] = [];
  currentProject: Project | null = null;

  searchTerm = '';
  selectedCategory = '';
  selectedTags: string[] = [];
  selectedCast = '';
  selectedBook = '';
  selectedPictureFilter: '' | 'with' | 'without' = '';
  povOnly = false;
  /** Character IDs that should show a PoV badge under current book context. */
  povCharacterIdSet = new Set<string>();
  /** Badge color for PoV pills (book color when a book is selected, else accent). */
  povBadgeColor = 'var(--color-accent-primary)';
  selectedCharacterIds: string[] = [];
  showCastNameForm = false;
  newCastName = '';

  allCharacters: Character[] = [];
  filteredCharacters: Character[] = [];
  // Use service cache - sync from service on init and after loading
  thumbnailDataUrls: Map<string, string> = new Map();
  thumbnailModificationTimes: Map<string, string> = new Map();
  isLoading = false;
  error: string | null = null;
  viewMode: 'grid' | 'list' | 'compact' | 'gallery' = 'grid'; // Toggle between grid (cards), list, compact, and gallery view
  columns: 1 | 2 = 2; // Column count for views
  sortBy: 'name' | 'category' = 'name';
  sortDirection: 'asc' | 'desc' = 'asc';
  groupBy: 'none' | 'category' | 'tag' | 'cast' | 'book' = 'none';
  selectedCharacterIndex = -1; // Track selected character for keyboard navigation
  filterExpanded = false; // Track filter expanded state
  filtersSidebarOpen = true;
  galleryThumbnailSize: 'big' | 'medium' | 'small' = 'big'; // Gallery thumbnail size
  characterStyles: CharacterStyle[] = [];
  selectedCharacterStyle = '';
  activeDropCategoryId: string | null = null;
  isUpdatingCategory = false;
  categoryDropListIds: string[] = [];
  isDraggingCharacter = false;
  private groupedCharacters: Array<{ categoryId: string; characters: Character[] }> = [];
  private groupedByTag: Array<{ tagId: string; characters: Character[] }> = [];
  private groupedByCast: Array<{ castId: string; characters: Character[] }> = [];
  private groupedByBook: Array<{ bookId: string; characters: Character[] }> = [];

  constructor(
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private metadataService: MetadataService,
    public metadataHelper: MetadataHelperService,
    private modalService: ModalService,
    private preferences: PreferencesService,
    private router: Router,
    private characterEditDialog: CharacterEditDialogService,
    private commandPaletteService: CommandPaletteService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private logger: LoggingService,
    private notificationService: NotificationService
  ) {
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
    const savedSidebarState = localStorage.getItem('characterFiltersSidebarOpen');
    if (savedSidebarState !== null) {
      this.filtersSidebarOpen = savedSidebarState === 'true';
    }

    // Load saved view mode preference
    this.viewMode = this.preferences.getViewMode();

    // Load saved columns preference
    this.columns = this.preferences.getColumns();

    // Load saved sort preferences
    const savedSortBy = this.preferences.getSortBy();
    if (savedSortBy) {
      this.sortBy = savedSortBy;
    }
    const savedSortDirection = localStorage.getItem('characterSortDirection') as 'asc' | 'desc';
    if (savedSortDirection) {
      this.sortDirection = savedSortDirection;
    }

    // Load saved groupBy preference
    const savedGroupBy = localStorage.getItem('characterGroupBy') as
      | 'none'
      | 'category'
      | 'tag'
      | 'cast'
      | 'book'
      | null;
    if (
      savedGroupBy === 'none' ||
      savedGroupBy === 'category' ||
      savedGroupBy === 'tag' ||
      savedGroupBy === 'cast' ||
      savedGroupBy === 'book'
    ) {
      this.groupBy = savedGroupBy;
    }

    // Load saved gallery thumbnail size preference
    this.galleryThumbnailSize = this.preferences.getGalleryThumbnailSize();

    // Load filter expanded state from project settings (not localStorage)
    // This will be loaded after project is loaded in the subscription below

    // Load saved filter preferences
    const savedSearchTerm = localStorage.getItem('characterSearchTerm');
    if (savedSearchTerm) {
      this.searchTerm = savedSearchTerm;
    }
    const savedSelectedCategory = localStorage.getItem('characterSelectedCategory');
    if (savedSelectedCategory) {
      this.selectedCategory = savedSelectedCategory;
    }
    const savedSelectedTags = localStorage.getItem('characterSelectedTags');
    if (savedSelectedTags) {
      try {
        this.selectedTags = JSON.parse(savedSelectedTags);
      } catch (error) {
        console.warn('Failed to parse saved selected tags:', error);
        this.selectedTags = [];
      }
    }
    const savedSelectedCast = localStorage.getItem('characterSelectedCast');
    if (savedSelectedCast) {
      this.selectedCast = savedSelectedCast;
    }
    const savedSelectedBook = localStorage.getItem('characterSelectedBook');
    if (savedSelectedBook) {
      this.selectedBook = savedSelectedBook;
    }
    const savedPictureFilter = localStorage.getItem('characterPictureFilter');
    if (savedPictureFilter === 'with' || savedPictureFilter === 'without') {
      this.selectedPictureFilter = savedPictureFilter;
    }
    const savedPovOnly = localStorage.getItem('characterPovOnly');
    if (savedPovOnly === 'true') {
      this.povOnly = true;
    }

    // Register command palette commands (cleared when leaving this page)
    this.registerCommands();
    this.destroyRef.onDestroy(() => {
      this.commandPaletteService.replaceGroup('create', []);
      this.commandPaletteService.replaceGroup('view', []);
      this.commandPaletteService.replaceGroup('characters', []);
    });

    // Subscribe to project changes
    this.projectService.currentProject$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((project) => {
      this.currentProject = project;
      this.categories = this.projectService.getCategories();
      this.tags = this.projectService.getTags();
      this.casts = this.metadataService.getCasts();
      this.books = this.metadataService.getBooks();
      this.recomputePovBadgeState();
      this.recomputeGroups();
      this.updateCategoryDropListIds();

      if (project) {
        // Load filter expanded state from project settings
        this.filterExpanded = project.metadata.lastSession?.lastCharacterListFilterExpanded ?? false;
        this.characterStyles = this.projectService.getCharacterStyles();
        const savedStyle = this.projectService.getLastCharacterListStyle();
        const defaultStyle = this.projectService.getDefaultCharacterStyle();
        this.selectedCharacterStyle =
          (savedStyle && this.characterStyles.some((s) => s.id === savedStyle)
            ? savedStyle
            : defaultStyle) || this.characterStyles[0]?.id || '';
        this.loadCharacters();
      }
    });

    // Subscribe to character changes and apply filters
    this.characters$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((characters) => {
      this.allCharacters = characters;
      this.filteredCharacters = this.filterAndSortCharacters(characters);
      this.recomputeGroups();
      this.updateCategoryDropListIds();
      // Sync cache from service first (to restore cached images)
      this.syncCacheFromService();
      this.loadThumbnailDataUrls(characters).then(() => {
        // Update command palette after thumbnails are loaded
        this.updateCharacterCommands(characters);
      });
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Ignore if user is typing in an input, textarea, or select
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      return;
    }

    // Enter to open selected character
    if (event.key === 'Enter' && this.selectedCharacterIndex >= 0) {
      event.preventDefault();
      const selectedCharacter = this.filteredCharacters[this.selectedCharacterIndex];
      if (selectedCharacter) {
        this.editCharacter(selectedCharacter);
      }
      return;
    }

    // N to create new character
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      this.createNewCharacter();
      return;
    }

    // L to toggle list/grid view
    if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      this.toggleViewMode();
      return;
    }
  }

  @HostListener('document:pointermove', ['$event'])
  onDocumentPointerMove(event: PointerEvent): void {
    if (!this.isCategoryDragDropEnabled() || !this.isDraggingCharacter) {
      return;
    }

    const el = this.scrollableContentRef?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const y = event.clientY;

    // Only auto-scroll when the pointer is within the scroll container vertical bounds
    if (y < rect.top || y > rect.bottom) return;

    const distanceToTop = y - rect.top;
    const distanceToBottom = rect.bottom - y;

    const threshold = this.dragAutoScrollThresholdPx;
    let direction = 0;
    let intensity = 0;

    if (distanceToTop >= 0 && distanceToTop < threshold) {
      direction = -1;
      intensity = (threshold - distanceToTop) / threshold;
    } else if (distanceToBottom >= 0 && distanceToBottom < threshold) {
      direction = 1;
      intensity = (threshold - distanceToBottom) / threshold;
    } else {
      return;
    }

    const step = Math.max(2, Math.round(this.dragAutoScrollMaxStepPx * intensity));
    el.scrollTop += direction * step;
  }

  private scrollToSelectedCharacter(): void {
    if (this.selectedCharacterIndex < 0) return;

    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      const selectedElement = document.querySelector(
        `.character-item[data-index="${this.selectedCharacterIndex}"]`
      ) as HTMLElement;

      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }, 0);
  }

  getCharacterClass(index: number): string {
    return this.selectedCharacterIndex === index ? 'selected' : '';
  }

  private registerCommands(): void {
    // Drop legacy combined group if present from earlier builds
    this.commandPaletteService.replaceGroup('actions', []);
    this.commandPaletteService.replaceGroup('create', [
      {
        id: 'new-character',
        label: 'New Character',
        icon: '➕',
        keywords: ['create', 'add', 'character', 'new'],
        group: 'create',
        action: () => this.createNewCharacter(),
      },
    ]);
    this.commandPaletteService.replaceGroup('view', [
      {
        id: 'toggle-view',
        label: `Toggle View (Currently: ${
          this.viewMode === 'grid' ? 'Grid' : this.viewMode === 'list' ? 'List' : this.viewMode === 'compact' ? 'Compact' : 'Gallery'
        })`,
        icon: this.viewMode === 'grid' ? '📋' : this.viewMode === 'list' ? '📱' : this.viewMode === 'compact' ? '📄' : '🖼️',
        keywords: ['view', 'grid', 'list', 'compact', 'gallery', 'toggle', 'switch'],
        group: 'view',
        action: () => this.toggleViewMode(),
      },
    ]);
  }

  private updateCharacterCommands(characters: Character[]): void {
    const characterCommands = characters.map((character) => ({
      id: `character-${character.id}`,
      label: character.name,
      thumbnail: this.thumbnailDataUrls.get(character.id) || undefined,
      metadata: this.metadataHelper.getCategoryName(character.category),
      keywords: [
        character.name,
        this.metadataHelper.getCategoryName(character.category),
        ...character.tags.map((tagId) => this.metadataHelper.getTagName(tagId)),
        ...character.books.map((bookId) => this.metadataHelper.getBookName(bookId)),
      ],
      group: 'characters',
      action: () => this.editCharacter(character),
    }));

    this.commandPaletteService.replaceGroup('characters', characterCommands);
  }

  async loadCharacters(): Promise<void> {
    if (!this.currentProject) return;

    try {
      this.isLoading = true;
      this.error = null;
      await this.characterService.loadCharacters(this.currentProject.path);
    } catch (error) {
      this.error = `Failed to load characters: ${error}`;
      this.logger.error('Failed to load characters:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async refreshCharacters(): Promise<void> {
    if (!this.currentProject) return;

    try {
      this.isLoading = true;
      this.error = null;
      await this.characterService.forceReloadCharacters();
    } catch (error) {
      this.error = `Failed to refresh characters: ${error}`;
      this.logger.error('Failed to refresh characters:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async scanForCharacters(): Promise<void> {
    if (!this.currentProject) return;

    try {
      this.isLoading = true;
      this.error = null;
      await this.characterService.scanForExistingCharacters();

      // Scan completed successfully
    } catch (error) {
      this.error = `Failed to scan for characters: ${error}`;
      this.logger.error('Failed to scan for characters:', error);
    } finally {
      this.isLoading = false;
    }
  }

  async testLoadSpecificFile(): Promise<void> {
    if (!this.currentProject) return;

    // Prompt user for filename
    const filename = prompt('Enter the exact filename of a character file (e.g., "my-character.md"):');
    if (!filename) return;

    try {
      this.isLoading = true;
      this.error = null;
      const character = await this.characterService.loadSpecificCharacterFile(filename);

      if (character) {
        this.notificationService.showSuccess(`Successfully loaded character: ${character.name}`);
      } else {
        this.notificationService.showError(`File not found or failed to load: ${filename}`);
      }
    } catch (error) {
      this.error = `Failed to load specific file: ${error}`;
      this.logger.error('Failed to load specific file:', error);
    } finally {
      this.isLoading = false;
    }
  }

  createNewCharacter(): void {
    this.characterEditDialog.openCreate();
  }

  editCharacter(character: Character): void {
    if (!character || !character.id) {
      this.logger.error('Character or character.id is missing:', character);
      return;
    }
    this.characterEditDialog.openEdit(character.id);
  }

  async deleteCharacter(character: Character, event: Event): Promise<void> {
    event.stopPropagation();

    if (await this.modalService.confirm(`Are you sure you want to delete "${character.name}"?\n\nThis action cannot be undone.`)) {
      try {
        await this.characterService.deleteCharacter(character.id);
        this.notificationService.showSuccess(`Character "${character.name}" deleted successfully`);
      } catch (error) {
        this.logger.error("Failed to delete character:", error);
      }
    }
  }

  onSearchChange(): void {
    // Save search term to localStorage
    this.preferences.setSearchTerm(this.searchTerm);
    // Apply filters immediately when search term changes
    this.applyFilters();
  }

  onCategoryChange(): void {
    // Save selected category to localStorage
    localStorage.setItem('characterSelectedCategory', this.selectedCategory);
    this.applyFilters();
  }

  onCategoryToggle(categoryId: string): void {
    // Single selection - set the selected category
    this.selectedCategory = categoryId;
    // Save selected category to localStorage
    localStorage.setItem('characterSelectedCategory', this.selectedCategory);
    this.applyFilters();
  }

  onTagToggle(tagId: string): void {
    const index = this.selectedTags.indexOf(tagId);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tagId);
    }
    // Save selected tags to localStorage
    localStorage.setItem('characterSelectedTags', JSON.stringify(this.selectedTags));
    this.applyFilters();
  }

  onCastChange(): void {
    // Save selected cast to localStorage
    localStorage.setItem('characterSelectedCast', this.selectedCast);
    this.applyFilters();
  }

  // Cast dropdown event handler
  onCastDropdownChange(castId: string): void {
    this.selectedCast = castId;
    this.onCastChange();
  }

  onBookChange(): void {
    // Save selected book to localStorage
    localStorage.setItem('characterSelectedBook', this.selectedBook);
    this.recomputePovBadgeState();
    this.applyFilters();
  }

  onPictureFilterChange(): void {
    if (this.selectedPictureFilter) {
      localStorage.setItem('characterPictureFilter', this.selectedPictureFilter);
    } else {
      localStorage.removeItem('characterPictureFilter');
    }
    this.applyFilters();
  }

  onPovOnlyChange(povOnly: boolean): void {
    this.povOnly = povOnly;
    if (povOnly) {
      localStorage.setItem('characterPovOnly', 'true');
    } else {
      localStorage.removeItem('characterPovOnly');
    }
    this.applyFilters();
  }

  async onFilterExpandedChange(expanded: boolean): Promise<void> {
    this.filterExpanded = expanded;
    // Save to project settings in ensemble.json
    await this.projectService.saveFilterExpandedState(expanded);
  }

  toggleFiltersSidebar(): void {
    this.filtersSidebarOpen = !this.filtersSidebarOpen;
    localStorage.setItem('characterFiltersSidebarOpen', String(this.filtersSidebarOpen));
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = '';
    this.selectedTags = [];
    this.selectedCast = '';
    this.selectedBook = '';
    this.selectedPictureFilter = '';
    this.povOnly = false;
    // Clear saved filter state
    localStorage.removeItem('characterSearchTerm');
    localStorage.removeItem('characterSelectedCategory');
    localStorage.removeItem('characterSelectedTags');
    localStorage.removeItem('characterSelectedCast');
    localStorage.removeItem('characterSelectedBook');
    localStorage.removeItem('characterPictureFilter');
    localStorage.removeItem('characterPovOnly');
    this.recomputePovBadgeState();
    this.applyFilters();
  }

  clearSearchTerm(): void {
    this.searchTerm = '';
    localStorage.removeItem('characterSearchTerm');
    this.applyFilters();
  }

  private applyFilters(): void {
    // Simply re-filter and sort the current character list
    // No need to subscribe again - the subscription in ngOnInit handles updates
    this.filteredCharacters = this.filterAndSortCharacters(this.allCharacters);
    this.recomputeGroups();
    this.updateCategoryDropListIds();
    // Reset selection when filters change
    this.selectedCharacterIndex = -1;
  }

  private filterAndSortCharacters(characters: Character[]): Character[] {
    const filtered = this.filterCharacters(characters);
    return this.sortCharacters(filtered);
  }

  private filterCharacters(characters: Character[]): Character[] {
    return characters.filter((character) => {
      // Search term filter - search names, categories, tags, and books
      if (this.searchTerm) {
        const searchLower = this.searchTerm.toLowerCase();
        const categoryName = this.metadataHelper
          .getCategoryName(resolveEffectiveCategory(character, this.selectedBook))
          .toLowerCase();
        const tagNames = character.tags.map((tagId) => this.metadataHelper.getTagName(tagId).toLowerCase());
        const bookNames = character.books.map((bookId) => this.metadataHelper.getBookName(bookId).toLowerCase());

        const matchesSearch =
          character.name.toLowerCase().includes(searchLower) ||
          categoryName.includes(searchLower) ||
          tagNames.some((tagName) => tagName.includes(searchLower)) ||
          bookNames.some((bookName) => bookName.includes(searchLower));

        if (!matchesSearch) return false;
      }

      // Category filter (uses effective category when a book is selected)
      if (this.selectedCategory) {
        const effectiveCategory = resolveEffectiveCategory(character, this.selectedBook);
        if (effectiveCategory !== this.selectedCategory) {
          return false;
        }
      }

      // Tags filter - character must have ALL selected tags
      if (this.selectedTags.length > 0) {
        const hasAllSelectedTags = this.selectedTags.every((tagId) => character.tags.includes(tagId));
        if (!hasAllSelectedTags) return false;
      }

      // Cast filter - character must be in the selected cast
      if (this.selectedCast) {
        const cast = this.casts.find((c) => c.id === this.selectedCast);
        if (cast && !cast.characterIds.includes(character.id)) {
          return false;
        }
      }

      // Book filter - character must be assigned to the selected book
      // Skipped when PoV-only is on: the PoV list for that book is authoritative.
      if (this.selectedBook && !this.povOnly) {
        if (!character.books || !character.books.includes(this.selectedBook)) {
          return false;
        }
      }

      // PoV-only filter
      if (this.povOnly) {
        if (!this.isCharacterPov(character.id)) {
          return false;
        }
      }

      // Picture filter — based on portrait for the active character style
      if (this.selectedPictureFilter) {
        const hasPicture = !!resolveThumbnailForStyle(
          character.thumbnails,
          this.selectedCharacterStyle
        );
        if (this.selectedPictureFilter === 'with' && !hasPicture) {
          return false;
        }
        if (this.selectedPictureFilter === 'without' && hasPicture) {
          return false;
        }
      }

      return true;
    });
  }

  /** Whether a character is PoV under the current book filter context. */
  isCharacterPov(characterId: string): boolean {
    return this.povCharacterIdSet.has(characterId);
  }

  private recomputePovBadgeState(): void {
    const ids = new Set<string>();
    if (this.selectedBook) {
      const book = this.books.find((b) => b.id === this.selectedBook);
      for (const id of book?.povCharacterIds || []) {
        ids.add(id);
      }
      this.povBadgeColor = book?.color || 'var(--color-accent-primary)';
    } else {
      for (const book of this.books) {
        for (const id of book.povCharacterIds || []) {
          ids.add(id);
        }
      }
      this.povBadgeColor = 'var(--color-accent-primary)';
    }
    this.povCharacterIdSet = ids;
  }


  getCategoryToggleOptions(): ToggleOption[] {
    return this.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      tooltip: cat.description || cat.name,
    }));
  }

  getTagsAsSelectableItems(): SelectableItem[] {
    return this.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    }));
  }

  onTagsSelectionChange(selectedIds: string[]): void {
    this.selectedTags = selectedIds;
    // Save selected tags to localStorage
    localStorage.setItem('characterSelectedTags', JSON.stringify(this.selectedTags));
    this.applyFilters();
  }


  getBookCharacterCount(bookId: string): number {
    // Get all characters (not just filtered ones) to show total count
    return this.allCharacters.filter((character) => character.books && character.books.includes(bookId)).length;
  }

  getBookCharacterCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const book of this.books) {
      counts.set(book.id, this.getBookCharacterCount(book.id));
    }
    return counts;
  }

  // Wrapper methods for child view components
  // These delegate to MetadataHelperService
  getCategoryName(categoryId: string): string {
    return this.metadataHelper.getCategoryName(categoryId);
  }

  getCategoryColor(categoryId: string): string {
    return this.metadataHelper.getCategoryColor(categoryId);
  }

  getCategoryTooltip(categoryId: string): string {
    return this.metadataHelper.getCategoryTooltip(categoryId);
  }

  getTagName(tagId: string): string {
    return this.metadataHelper.getTagName(tagId);
  }

  getTagColor(tagId: string): string {
    return this.metadataHelper.getTagColor(tagId);
  }

  getBookName(bookId: string): string {
    return this.metadataHelper.getBookName(bookId);
  }

  getBookColor(bookId: string): string {
    return this.metadataHelper.getBookColor(bookId);
  }

  getCharacterTagsInOrder(character: Character): Tag[] {
    // Return tags in the order they appear in the metadata, filtered by what the character has
    return this.tags.filter((tag) => character.tags.includes(tag.id));
  }

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  /**
   * Syncs local cache Maps from service cache (for child component Inputs)
   */
  private syncCacheFromService(): void {
    this.thumbnailDataUrls = this.characterService.getAllCachedThumbnails(this.selectedCharacterStyle);
    this.thumbnailModificationTimes.clear();
    this.allCharacters.forEach(char => {
      const modTime = this.characterService.getCachedThumbnailModTime(char.id, this.selectedCharacterStyle);
      if (modTime) {
        this.thumbnailModificationTimes.set(char.id, modTime);
      }
    });
  }

  private async loadThumbnailDataUrls(characters: Character[]): Promise<void> {
    await this.characterService.loadThumbnailsForCharacters(characters, this.selectedCharacterStyle);
    this.syncCacheFromService();
    this.cdr.detectChanges();
  }

  async setCharacterStyle(styleId: string): Promise<void> {
    if (!styleId || styleId === this.selectedCharacterStyle) {
      return;
    }
    this.selectedCharacterStyle = styleId;
    await this.projectService.saveLastCharacterListStyle(styleId);
    this.syncCacheFromService();
    await this.loadThumbnailDataUrls(this.allCharacters);
    this.applyFilters();
    this.updateCharacterCommands(this.allCharacters);
    this.cdr.detectChanges();
  }

getFilterSummary(): string {
    const filters: string[] = [];

    if (this.searchTerm) {
      filters.push(`search: "${this.searchTerm}"`);
    }

    if (this.selectedCategory) {
      const categoryName = this.metadataHelper.getCategoryName(this.selectedCategory);
      filters.push(`category: ${categoryName}`);
    }

    if (this.selectedTags.length > 0) {
      const tagNames = this.selectedTags.map((tagId) => this.metadataHelper.getTagName(tagId));
      filters.push(`tags: ${tagNames.join(', ')}`);
    }

    if (this.selectedCast) {
      const cast = this.casts.find((c) => c.id === this.selectedCast);
      if (cast) {
        filters.push(`cast: ${cast.name}`);
      }
    }

    if (this.selectedBook) {
      const bookName = this.metadataHelper.getBookName(this.selectedBook);
      filters.push(`book: ${bookName}`);
    }

    if (this.selectedPictureFilter === 'with') {
      filters.push('with pictures');
    } else if (this.selectedPictureFilter === 'without') {
      filters.push('without pictures');
    }

    return filters.length > 0 ? `Filtered by ${filters.join(', ')}` : '';
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }

  toggleViewMode(): void {
    if (this.viewMode === 'grid') {
      this.viewMode = 'list';
    } else if (this.viewMode === 'list') {
      this.viewMode = 'compact';
    } else if (this.viewMode === 'compact') {
      this.viewMode = 'gallery';
    } else {
      this.viewMode = 'grid';
    }
    this.preferences.setViewMode(this.viewMode);
    this.registerCommands();
  }

  setViewMode(mode: 'grid' | 'list' | 'compact' | 'gallery'): void {
    this.viewMode = mode;
    this.preferences.setViewMode(this.viewMode);
    this.registerCommands();
  }

  setColumns(count: 1 | 2): void {
    this.columns = count;
    localStorage.setItem('characterColumns', count.toString());
  }

  setGalleryThumbnailSize(size: 'big' | 'medium' | 'small'): void {
    this.galleryThumbnailSize = size;
    this.preferences.setGalleryThumbnailSize(size);
  }

  // Multi-select functionality
  toggleCharacterSelection(characterId: string): void {
    const index = this.selectedCharacterIds.indexOf(characterId);
    if (index > -1) {
      this.selectedCharacterIds.splice(index, 1);
    } else {
      this.selectedCharacterIds.push(characterId);
    }
  }

  isCharacterSelected(characterId: string): boolean {
    return this.selectedCharacterIds.includes(characterId);
  }

  showCastNameFormDialog(): void {
    if (this.selectedCharacterIds.length === 0) {
      this.error = 'Please select at least one character to create a cast.';
      return;
    }
    this.showCastNameForm = true;
    this.newCastName = '';
    this.error = null;
  }

  cancelCastForm(): void {
    this.showCastNameForm = false;
    this.newCastName = '';
  }

  async saveSelectionAsCast(): Promise<void> {
    if (!this.newCastName || this.newCastName.trim() === '') {
      this.error = 'Please enter a name for the cast.';
      return;
    }

    try {
      await this.metadataService.addCast({
        name: this.newCastName.trim(),
        characterIds: [...this.selectedCharacterIds],
      });

      // Clear selection and form after saving
      this.selectedCharacterIds = [];
      this.showCastNameForm = false;
      this.newCastName = '';
      this.error = null;

      // Reload casts
      this.casts = this.metadataService.getCasts();
    } catch (error) {
      this.error = `Failed to create cast: ${error}`;
      this.logger.error('Failed to create cast:', error);
    }
  }

  setSortBy(sortBy: 'name' | 'category'): void {
    if (this.sortBy === sortBy) {
      // Toggle direction if clicking the same sort
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // Default to ascending for new sort
      this.sortBy = sortBy;
      this.sortDirection = 'asc';
    }

    localStorage.setItem('characterSortBy', this.sortBy);
    localStorage.setItem('characterSortDirection', this.sortDirection);
    this.applyFilters();
  }

  setGroupBy(groupBy: 'none' | 'category' | 'tag' | 'cast' | 'book'): void {
    this.groupBy = groupBy;
    localStorage.setItem('characterGroupBy', this.groupBy);
    this.activeDropCategoryId = null;
    this.updateCategoryDropListIds();
  }

  isCategoryDragDropEnabled(): boolean {
    // Disable while a book filter is active — drag would ambiguously change
    // the default category rather than the book-specific override.
    return this.groupBy === 'category' && !this.isUpdatingCategory && !this.selectedBook;
  }

  getCategoryDropListId(categoryId: string): string {
    return `category-drop-${encodeURIComponent(categoryId)}`;
  }

  getConnectedCategoryDropListIds(): string[] {
    return this.categoryDropListIds;
  }

  private sortCharacters(characters: Character[]): Character[] {
    const sorted = [...characters];

    if (this.sortBy === 'name') {
      sorted.sort((a, b) => {
        const comparison = a.name.localeCompare(b.name);
        return this.sortDirection === 'asc' ? comparison : -comparison;
      });
    } else if (this.sortBy === 'category') {
      // Sort by category position in the categories array (effective when book filter set)
      sorted.sort((a, b) => {
        const aCategoryIndex = this.categories.findIndex(
          (cat) => cat.id === resolveEffectiveCategory(a, this.selectedBook)
        );
        const bCategoryIndex = this.categories.findIndex(
          (cat) => cat.id === resolveEffectiveCategory(b, this.selectedBook)
        );

        // If category not found, put at end
        const aIndex = aCategoryIndex === -1 ? 9999 : aCategoryIndex;
        const bIndex = bCategoryIndex === -1 ? 9999 : bCategoryIndex;

        // Primary sort by category order
        const categoryComparison = aIndex - bIndex;

        if (categoryComparison !== 0) {
          return this.sortDirection === 'asc' ? categoryComparison : -categoryComparison;
        }

        // Secondary sort by name within same category
        return a.name.localeCompare(b.name);
      });
    }

    return sorted;
  }

  // Methods for view components
  onViewCharacterClick(character: Character): void {
    this.editCharacter(character);
  }

  onViewCharacterDelete(event: { character: Character; event: Event }): void {
    this.deleteCharacter(event.character, event.event);
  }

  onViewCharacterSelectionToggle(characterId: string): void {
    this.toggleCharacterSelection(characterId);
  }

  getGroupedCharacters(): Array<{
    categoryId: string;
    characters: Character[];
  }> {
    return this.groupedCharacters;
  }

  private recomputeGroups(): void {
    this.groupedCharacters = this.computeGroupedCharacters();
    this.groupedByTag = this.computeGroupedByTag();
    this.groupedByCast = this.computeGroupedByCast();
    this.groupedByBook = this.computeGroupedByBook();
  }

  private computeGroupedCharacters(): Array<{
    categoryId: string;
    characters: Character[];
  }> {
    const grouped = new Map<string, Character[]>();

    // Group characters by effective category (book override when book filter set)
    for (const character of this.filteredCharacters) {
      const categoryId =
        resolveEffectiveCategory(character, this.selectedBook) || 'uncategorized';
      if (!grouped.has(categoryId)) {
        grouped.set(categoryId, []);
      }
      grouped.get(categoryId)!.push(character);
    }

    // Sort groups by category order in metadata and convert to array
    const result: Array<{ categoryId: string; characters: Character[] }> = [];

    // First add categories in the order they appear in metadata
    for (const category of this.categories) {
      if (grouped.has(category.id)) {
        result.push({
          categoryId: category.id,
          characters: grouped.get(category.id)!,
        });
      }
    }

    // Then add any uncategorized characters
    if (grouped.has('uncategorized')) {
      result.push({
        categoryId: 'uncategorized',
        characters: grouped.get('uncategorized')!,
      });
    }

    return result;
  }

  private updateCategoryDropListIds(): void {
    this.categoryDropListIds = this.groupedCharacters.map((group) =>
      this.getCategoryDropListId(group.categoryId)
    );
  }

  async onCategoryDrop(event: CdkDragDrop<Character[]>, targetCategoryId: string): Promise<void> {
    this.activeDropCategoryId = null;
    if (!this.isCategoryDragDropEnabled()) {
      return;
    }

    const draggedCharacter = event.item.data as Character | undefined;
    if (!draggedCharacter) {
      return;
    }

    if (draggedCharacter.category === targetCategoryId) {
      return;
    }

    try {
      this.isUpdatingCategory = true;
      const updated = await this.characterService.updateCharacter(draggedCharacter.id, {
        category: targetCategoryId,
      });

      if (!updated) {
        this.notificationService.showError('Could not move character to the selected category.');
        return;
      }

      const targetCategoryName = this.metadataHelper.getCategoryName(targetCategoryId);
      this.notificationService.showSuccess(`Moved "${updated.name}" to ${targetCategoryName}.`);
    } catch (error) {
      this.logger.error('Failed to move character to category:', error);
      this.notificationService.showError('Failed to move character. Please try again.');
    } finally {
      this.isUpdatingCategory = false;
      this.updateCategoryDropListIds();
    }
  }

  getGroupedByTag(): Array<{ tagId: string; characters: Character[] }> {
    return this.groupedByTag;
  }

  getGroupedByCast(): Array<{ castId: string; characters: Character[] }> {
    return this.groupedByCast;
  }

  getGroupedByBook(): Array<{ bookId: string; characters: Character[] }> {
    return this.groupedByBook;
  }

  private computeGroupedByTag(): Array<{ tagId: string; characters: Character[] }> {
    const grouped = new Map<string, Character[]>();

    // Group characters by tag (characters can appear in multiple groups)
    for (const character of this.filteredCharacters) {
      if (character.tags && character.tags.length > 0) {
        for (const tagId of character.tags) {
          if (!grouped.has(tagId)) {
            grouped.set(tagId, []);
          }
          grouped.get(tagId)!.push(character);
        }
      } else {
        // Characters with no tags
        if (!grouped.has('untagged')) {
          grouped.set('untagged', []);
        }
        grouped.get('untagged')!.push(character);
      }
    }

    // Sort groups by tag order in metadata and convert to array
    const result: Array<{ tagId: string; characters: Character[] }> = [];

    // First add tags in the order they appear in metadata
    for (const tag of this.tags) {
      if (grouped.has(tag.id)) {
        result.push({
          tagId: tag.id,
          characters: grouped.get(tag.id)!,
        });
      }
    }

    // Then add any untagged characters
    if (grouped.has('untagged')) {
      result.push({
        tagId: 'untagged',
        characters: grouped.get('untagged')!,
      });
    }

    return result;
  }

  private computeGroupedByCast(): Array<{ castId: string; characters: Character[] }> {
    const grouped = new Map<string, Character[]>();
    const characterCastIds = new Map<string, string[]>();

    for (const cast of this.casts) {
      for (const characterId of cast.characterIds) {
        const existing = characterCastIds.get(characterId) || [];
        existing.push(cast.id);
        characterCastIds.set(characterId, existing);
      }
    }

    // Group characters by cast (characters can appear in multiple groups)
    for (const character of this.filteredCharacters) {
      const castIds = characterCastIds.get(character.id) || [];
      if (castIds.length > 0) {
        for (const castId of castIds) {
          if (!grouped.has(castId)) {
            grouped.set(castId, []);
          }
          grouped.get(castId)!.push(character);
        }
      } else {
        if (!grouped.has('no-cast')) {
          grouped.set('no-cast', []);
        }
        grouped.get('no-cast')!.push(character);
      }
    }

    const result: Array<{ castId: string; characters: Character[] }> = [];

    for (const cast of this.casts) {
      if (grouped.has(cast.id)) {
        result.push({
          castId: cast.id,
          characters: grouped.get(cast.id)!,
        });
      }
    }

    if (grouped.has('no-cast')) {
      result.push({
        castId: 'no-cast',
        characters: grouped.get('no-cast')!,
      });
    }

    return result;
  }

  private computeGroupedByBook(): Array<{ bookId: string; characters: Character[] }> {
    const grouped = new Map<string, Character[]>();

    // Group characters by book (characters can appear in multiple groups)
    for (const character of this.filteredCharacters) {
      if (character.books && character.books.length > 0) {
        for (const bookId of character.books) {
          if (!grouped.has(bookId)) {
            grouped.set(bookId, []);
          }
          grouped.get(bookId)!.push(character);
        }
      } else {
        if (!grouped.has('no-book')) {
          grouped.set('no-book', []);
        }
        grouped.get('no-book')!.push(character);
      }
    }

    const result: Array<{ bookId: string; characters: Character[] }> = [];

    for (const book of this.books) {
      if (grouped.has(book.id)) {
        result.push({
          bookId: book.id,
          characters: grouped.get(book.id)!,
        });
      }
    }

    if (grouped.has('no-book')) {
      result.push({
        bookId: 'no-book',
        characters: grouped.get('no-book')!,
      });
    }

    return result;
  }

  onAnyCharacterDragStarted(): void {
    this.isDraggingCharacter = true;
  }

  onAnyCharacterDragEnded(): void {
    setTimeout(() => {
      this.isDraggingCharacter = false;
      this.activeDropCategoryId = null;
    }, 0);
  }

  onCategoryDragEntered(categoryId: string): void {
    if (!this.isCategoryDragDropEnabled() || !this.isDraggingCharacter) {
      return;
    }
    this.activeDropCategoryId = categoryId;
  }

  onCategoryDragExited(categoryId: string): void {
    if (this.activeDropCategoryId === categoryId) {
      this.activeDropCategoryId = null;
    }
  }

  /**
   * Calculate the relative luminance of a color to determine if we should use
   * white or black text for contrast.
   */
  getContrastTextColor(backgroundColor: string): string {
    return contrastTextColor(backgroundColor);
  }
}
