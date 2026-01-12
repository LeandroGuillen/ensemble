import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Book, Cast, Category, Character, Project, Tag } from '../../core/interfaces';
import { CharacterService, ElectronService, MetadataService, ProjectService } from '../../core/services';
import { MetadataHelperService } from '../../core/services/metadata-helper.service';
import { ModalService } from '../../core/services/modal.service';
import { PreferencesService } from '../../core/services/preferences.service';
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
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    CharacterFilterComponent,
    CharacterGridViewComponent,
    CharacterListViewComponent,
    CharacterCompactViewComponent,
    CharacterGalleryViewComponent,
  ],
  templateUrl: './character-list.component.html',
  styleUrls: ['./character-list.component.scss'],
})
export class CharacterListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

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
  selectedCharacterIds: string[] = [];
  showCastNameForm = false;
  newCastName = '';

  allCharacters: Character[] = [];
  filteredCharacters: Character[] = [];
  thumbnailDataUrls: Map<string, string> = new Map();
  thumbnailModificationTimes: Map<string, string> = new Map(); // Track modification times
  characterImagesDataUrls: Map<string, string[]> = new Map(); // All images per character for slideshow
  isLoading = false;
  error: string | null = null;
  viewMode: 'grid' | 'list' | 'compact' | 'gallery' = 'grid'; // Toggle between grid (cards), list, compact, and gallery view
  columns: 1 | 2 = 2; // Column count for views
  sortBy: 'name' | 'category' = 'name';
  sortDirection: 'asc' | 'desc' = 'asc';
  groupBy: 'none' | 'category' | 'tag' = 'none'; // Group characters by category or tag
  selectedCharacterIndex = -1; // Track selected character for keyboard navigation
  filterExpanded = false; // Track filter expanded state
  slideshowEnabled = true; // Toggle slideshow on/off
  galleryThumbnailSize: 'big' | 'medium' | 'small' = 'big'; // Gallery thumbnail size

  constructor(
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private metadataService: MetadataService,
    public metadataHelper: MetadataHelperService,
    private modalService: ModalService,
    private preferences: PreferencesService,
    private router: Router,
    private commandPaletteService: CommandPaletteService,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
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
    const savedGroupBy = localStorage.getItem('characterGroupBy') as 'none' | 'category' | 'tag';
    if (savedGroupBy) {
      this.groupBy = savedGroupBy;
    }

    // Load saved slideshow preference
    const savedSlideshowEnabled = localStorage.getItem('characterSlideshowEnabled');
    if (savedSlideshowEnabled !== null) {
      this.slideshowEnabled = savedSlideshowEnabled === 'true';
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

    // Register command palette commands
    this.registerCommands();

    // Subscribe to project changes
    this.projectService.currentProject$.pipe(takeUntil(this.destroy$)).subscribe((project) => {
      this.currentProject = project;
      this.categories = this.projectService.getCategories();
      this.tags = this.projectService.getTags();
      this.casts = this.metadataService.getCasts();
      this.books = this.metadataService.getBooks();

      if (project) {
        // Load filter expanded state from project settings
        this.filterExpanded = project.metadata.settings.filterExpanded ?? false;
        this.loadCharacters();
      }
    });

    // Subscribe to character changes and apply filters
    this.characters$.pipe(takeUntil(this.destroy$)).subscribe((characters) => {
      this.allCharacters = characters;
      this.filteredCharacters = this.filterAndSortCharacters(characters);
      this.loadThumbnailDataUrls(characters).then(() => {
        // Update command palette after thumbnails are loaded
        this.updateCharacterCommands(characters);
      });
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    const baseCommands = [
      {
        id: 'new-character',
        label: 'New Character',
        icon: '➕',
        keywords: ['create', 'add', 'character'],
        group: 'actions',
        action: () => this.createNewCharacter(),
      },
      {
        id: 'toggle-view',
        label: `Toggle View (Currently: ${
          this.viewMode === 'grid' ? 'Grid' : this.viewMode === 'list' ? 'List' : 'Compact'
        })`,
        icon: this.viewMode === 'grid' ? '📋' : this.viewMode === 'list' ? '📱' : '📄',
        keywords: ['view', 'grid', 'list', 'compact', 'toggle', 'switch'],
        group: 'actions',
        action: () => this.toggleViewMode(),
      },
    ];

    this.commandPaletteService.registerCommands(baseCommands);
  }

  private updateCharacterCommands(characters: Character[]): void {
    // Remove old character commands
    const currentCommands = this.commandPaletteService['commandsSubject'].value;
    const nonCharacterCommands = currentCommands.filter((cmd) => cmd.group !== 'characters');

    // Create commands for each character
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

    // Register all commands
    this.commandPaletteService.registerCommands([...nonCharacterCommands, ...characterCommands]);
  }

  async loadCharacters(): Promise<void> {
    if (!this.currentProject) return;

    try {
      this.isLoading = true;
      this.error = null;
      await this.characterService.loadCharacters(this.currentProject.path);
    } catch (error) {
      this.error = `Failed to load characters: ${error}`;
      console.error('Failed to load characters:', error);
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
      console.error('Failed to refresh characters:', error);
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
      console.error('Failed to scan for characters:', error);
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
        alert(`Successfully loaded character: ${character.name}`);
      } else {
        alert(`File not found or failed to load: ${filename}`);
      }
    } catch (error) {
      this.error = `Failed to load specific file: ${error}`;
      console.error('Failed to load specific file:', error);
    } finally {
      this.isLoading = false;
    }
  }

  createNewCharacter(): void {
    this.router.navigate(['/character/new']);
  }

  editCharacter(character: Character): void {
    if (!character || !character.id) {
      console.error('Character or character.id is missing:', character);
      return;
    }
    this.router.navigate(['/character', character.id]);
  }

  async deleteCharacter(character: Character, event: Event): Promise<void> {
    event.stopPropagation();

    if (await this.modalService.confirm(`Are you sure you want to delete "${character.name}"?\n\nThis action cannot be undone.`)) {
      try {
        await this.characterService.deleteCharacter(character.id);
      } catch (error) {
        alert(`Failed to delete character: ${error}`);
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
    this.applyFilters();
  }

  async onFilterExpandedChange(expanded: boolean): Promise<void> {
    this.filterExpanded = expanded;
    // Save to project settings in ensemble.json
    await this.projectService.saveFilterExpandedState(expanded);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = '';
    this.selectedTags = [];
    this.selectedCast = '';
    this.selectedBook = '';
    // Clear saved filter state
    localStorage.removeItem('characterSearchTerm');
    localStorage.removeItem('characterSelectedCategory');
    localStorage.removeItem('characterSelectedTags');
    localStorage.removeItem('characterSelectedCast');
    localStorage.removeItem('characterSelectedBook');
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
        const categoryName = this.metadataHelper.getCategoryName(character.category).toLowerCase();
        const tagNames = character.tags.map((tagId) => this.metadataHelper.getTagName(tagId).toLowerCase());
        const bookNames = character.books.map((bookId) => this.metadataHelper.getBookName(bookId).toLowerCase());

        const matchesSearch =
          character.name.toLowerCase().includes(searchLower) ||
          categoryName.includes(searchLower) ||
          tagNames.some((tagName) => tagName.includes(searchLower)) ||
          bookNames.some((bookName) => bookName.includes(searchLower));

        if (!matchesSearch) return false;
      }

      // Category filter
      if (this.selectedCategory && character.category !== this.selectedCategory) {
        return false;
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
      if (this.selectedBook) {
        if (!character.books || !character.books.includes(this.selectedBook)) {
          return false;
        }
      }

      return true;
    });
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

  getThumbnailPath(character: Character): string | null {
    if (!this.currentProject) {
      return null;
    }

    // Try to get primary image from images array first
    const primaryImage = this.characterService.getPrimaryImage(character);
    if (primaryImage) {
      // Check both new (images/) and old (root) locations
      // The character service's getImagePath handles this, but we need a sync path here
      // So we'll try the most likely location first
      if (primaryImage.filename.includes('/')) {
        return `${character.folderPath}/${primaryImage.filename}`;
      } else {
        // Could be in images/ or root - try images/ first as that's the new standard
        return `${character.folderPath}/images/${primaryImage.filename}`;
      }
    }

    // Fallback to old thumbnail field for backward compatibility
    if (character.thumbnail) {
      return `${character.folderPath}/${character.thumbnail}`;
    }

    return null;
  }

  async getThumbnailDataUrl(character: Character): Promise<string | null> {
    if (!this.currentProject) {
      return null;
    }

    try {
      // Try to get primary image from images array first
      const primaryImage = this.characterService.getPrimaryImage(character);

      if (primaryImage) {
        // Try new location first (images/ subfolder), then old location (root)
        let thumbnailPath: string;

        if (primaryImage.filename.includes('/')) {
          // Filename includes path, use as-is
          thumbnailPath = `${character.folderPath}/${primaryImage.filename}`;
        } else {
          // Try images/ folder first
          const newPath = `${character.folderPath}/images/${primaryImage.filename}`;
          const existsInNew = await this.electronService.fileExists(newPath);

          if (existsInNew) {
            thumbnailPath = newPath;
          } else {
            // Fall back to root folder
            thumbnailPath = `${character.folderPath}/${primaryImage.filename}`;
          }
        }

        return await this.electronService.getImageAsDataUrl(thumbnailPath);
      }

      // Fallback to old thumbnail field
      if (character.thumbnail) {
        const thumbnailPath = `${character.folderPath}/${character.thumbnail}`;
        return await this.electronService.getImageAsDataUrl(thumbnailPath);
      }

      return null;
    } catch (error) {
      console.error('Failed to load thumbnail as data URL:', error);
      return null;
    }
  }

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  private async loadThumbnailDataUrls(characters: Character[]): Promise<void> {
    // Load all thumbnails outside Angular's zone
    await this.ngZone.runOutsideAngular(async () => {
      const thumbnailPromises = characters.map(async (character) => {
        try {
          // Check if character has a primary image or thumbnail
          const primaryImage = this.characterService.getPrimaryImage(character);
          const hasThumbnail = primaryImage || character.thumbnail;

          if (!hasThumbnail) {
            // No thumbnail, remove from cache if present
            if (this.thumbnailDataUrls.has(character.id)) {
              this.thumbnailDataUrls.delete(character.id);
              this.thumbnailModificationTimes.delete(character.id);
              this.characterImagesDataUrls.delete(character.id);
            }
            return;
          }

          // Check if we need to reload the thumbnail
          // Reload if: not cached, or character was modified since last cache
          const cachedModTime = this.thumbnailModificationTimes.get(character.id);
          const currentModTime = character.modified.toISOString();
          const needsReload =
            !this.thumbnailDataUrls.has(character.id) || cachedModTime !== currentModTime;

          if (needsReload) {
            const dataUrl = await this.getThumbnailDataUrl(character);
            if (dataUrl) {
              this.thumbnailDataUrls.set(character.id, dataUrl);
              this.thumbnailModificationTimes.set(character.id, currentModTime);
            }

            // Load all images for slideshow
            await this.loadAllCharacterImages(character);
          }
        } catch (error) {
          console.error(`Failed to load thumbnail for character ${character.name}:`, error);
        }
      });

      await Promise.all(thumbnailPromises);
    });

    // Trigger a single change detection after all thumbnails are loaded
    this.cdr.detectChanges();
  }

  private async loadAllCharacterImages(character: Character): Promise<void> {
    if (!character.images || character.images.length === 0) {
      this.characterImagesDataUrls.delete(character.id);
      return;
    }

    try {
      const imageDataUrls: string[] = [];

      // Load all images (sorted by order)
      const sortedImages = [...character.images].sort((a, b) => a.order - b.order);

      for (const image of sortedImages) {
        const imagePath = await this.characterService.getImagePath(character.id, image.id);
        if (imagePath) {
          const dataUrl = await this.electronService.getImageAsDataUrl(imagePath);
          if (dataUrl) {
            imageDataUrls.push(dataUrl);
          }
        }
      }

      if (imageDataUrls.length > 0) {
        this.characterImagesDataUrls.set(character.id, imageDataUrls);
      }
    } catch (error) {
      console.error(`Failed to load images for character ${character.name}:`, error);
    }
  }

  getCharacterImages(character: Character): string[] {
    return this.characterImagesDataUrls.get(character.id) || [];
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
  }

  setViewMode(mode: 'grid' | 'list' | 'compact' | 'gallery'): void {
    this.viewMode = mode;
    this.preferences.setViewMode(this.viewMode);
  }

  setColumns(count: 1 | 2): void {
    this.columns = count;
    localStorage.setItem('characterColumns', count.toString());
  }

  toggleSlideshow(): void {
    this.slideshowEnabled = !this.slideshowEnabled;
    localStorage.setItem('characterSlideshowEnabled', this.slideshowEnabled.toString());
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
      console.error('Failed to create cast:', error);
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

  setGroupBy(groupBy: 'none' | 'category' | 'tag'): void {
    this.groupBy = groupBy;
    localStorage.setItem('characterGroupBy', this.groupBy);
  }

  private sortCharacters(characters: Character[]): Character[] {
    const sorted = [...characters];

    if (this.sortBy === 'name') {
      sorted.sort((a, b) => {
        const comparison = a.name.localeCompare(b.name);
        return this.sortDirection === 'asc' ? comparison : -comparison;
      });
    } else if (this.sortBy === 'category') {
      // Sort by category position in the categories array
      sorted.sort((a, b) => {
        const aCategoryIndex = this.categories.findIndex((cat) => cat.id === a.category);
        const bCategoryIndex = this.categories.findIndex((cat) => cat.id === b.category);

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

  // Trash management methods
  async viewTrash(): Promise<void> {
    try {
      const deletedCharacters = await this.characterService.getDeletedCharacters();
      console.log('Deleted characters:', deletedCharacters);
      // TODO: Show trash UI/modal with deletedCharacters
      // Each item has: folderName, name, deletedAt
    } catch (error) {
      this.error = `Failed to load trash: ${error}`;
      console.error('Failed to load trash:', error);
    }
  }

  async restoreCharacter(folderName: string): Promise<void> {
    try {
      await this.characterService.restoreCharacter(folderName);
      // Characters are automatically reloaded after restore
    } catch (error) {
      this.error = `Failed to restore character: ${error}`;
      console.error('Failed to restore character:', error);
    }
  }

  async emptyTrash(): Promise<void> {
    if (
      !(await this.modalService.confirm('Are you sure you want to permanently delete all characters in trash?\n\nThis action cannot be undone.'))
    ) {
      return;
    }

    try {
      await this.characterService.emptyTrash();
    } catch (error) {
      this.error = `Failed to empty trash: ${error}`;
      console.error('Failed to empty trash:', error);
    }
  }

  async permanentlyDeleteCharacter(folderName: string): Promise<void> {
    if (!(await this.modalService.confirm('Are you sure you want to permanently delete this character?\n\nThis action cannot be undone.'))) {
      return;
    }

    try {
      await this.characterService.permanentlyDeleteCharacter(folderName);
    } catch (error) {
      this.error = `Failed to permanently delete character: ${error}`;
      console.error('Failed to permanently delete character:', error);
    }
  }

  getGroupedCharacters(): Array<{
    categoryId: string;
    characters: Character[];
  }> {
    const grouped = new Map<string, Character[]>();

    // Group characters by category
    for (const character of this.filteredCharacters) {
      const categoryId = character.category || 'uncategorized';
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

  getGroupedByTag(): Array<{ tagId: string; characters: Character[] }> {
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

  /**
   * Calculate the relative luminance of a color to determine if we should use
   * white or black text for contrast.
   * Based on WCAG guidelines: https://www.w3.org/TR/WCAG20/#relativeluminancedef
   */
  getContrastTextColor(backgroundColor: string): string {
    // Convert hex to RGB
    let r = 0,
      g = 0,
      b = 0;

    // Handle hex colors (#RGB or #RRGGBB)
    if (backgroundColor.startsWith('#')) {
      const hex = backgroundColor.substring(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      }
    }

    // Calculate relative luminance
    const rsRGB = r / 255;
    const gsRGB = g / 255;
    const bsRGB = b / 255;

    const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
    const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
    const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

    const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;

    // Use white text on dark backgrounds, black text on light backgrounds
    // Threshold of 0.5 works well for most cases
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }
}
