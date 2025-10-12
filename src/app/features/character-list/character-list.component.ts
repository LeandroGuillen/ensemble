import { Component, OnInit, OnDestroy, HostListener } from "@angular/core";
import { Router } from "@angular/router";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Observable, Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import { Character, Category, Tag, Project, Cast, Book } from "../../core/interfaces";
import {
  CharacterService,
  ProjectService,
  ElectronService,
  MetadataService,
} from "../../core/services";
import { CommandPaletteService } from "../../shared/command-palette/command-palette.service";
import { CategoryToggleComponent, ToggleOption } from "../../shared/category-toggle/category-toggle.component";
import { MultiSelectButtonsComponent, SelectableItem } from "../../shared/multi-select-buttons/multi-select-buttons.component";

@Component({
  selector: "app-character-list",
  standalone: true,
  imports: [CommonModule, FormsModule, CategoryToggleComponent, MultiSelectButtonsComponent],
  templateUrl: "./character-list.component.html",
  styleUrls: ["./character-list.component.scss"],
})
export class CharacterListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  characters$: Observable<Character[]>;
  categories: Category[] = [];
  tags: Tag[] = [];
  casts: Cast[] = [];
  books: Book[] = [];
  currentProject: Project | null = null;

  searchTerm = "";
  selectedCategory = "";
  selectedTags: string[] = [];
  selectedCast = "";
  selectedBook = "";
  selectedCharacterIds: string[] = [];
  showCastNameForm = false;
  newCastName = "";

  allCharacters: Character[] = [];
  filteredCharacters: Character[] = [];
  thumbnailDataUrls: Map<string, string> = new Map();
  isLoading = false;
  error: string | null = null;
  viewMode: "grid" | "list" | "compact" | "gallery" = "grid"; // Toggle between grid (cards), list, compact, and gallery view
  sortBy: "name" | "category" = "name";
  sortDirection: "asc" | "desc" = "asc";
  selectedCharacterIndex = -1; // Track selected character for keyboard navigation

  constructor(
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private metadataService: MetadataService,
    private router: Router,
    private commandPaletteService: CommandPaletteService
  ) {
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
    // Load saved view mode preference
    const savedViewMode = localStorage.getItem("characterViewMode") as
      | "grid"
      | "list"
      | "compact"
      | "gallery";
    if (savedViewMode) {
      this.viewMode = savedViewMode;
    }

    // Load saved sort preferences
    const savedSortBy = localStorage.getItem("characterSortBy") as
      | "name"
      | "category";
    if (savedSortBy) {
      this.sortBy = savedSortBy;
    }
    const savedSortDirection = localStorage.getItem(
      "characterSortDirection"
    ) as "asc" | "desc";
    if (savedSortDirection) {
      this.sortDirection = savedSortDirection;
    }

    // Load saved filter preferences
    const savedSearchTerm = localStorage.getItem("characterSearchTerm");
    if (savedSearchTerm) {
      this.searchTerm = savedSearchTerm;
    }
    const savedSelectedCategory = localStorage.getItem("characterSelectedCategory");
    if (savedSelectedCategory) {
      this.selectedCategory = savedSelectedCategory;
    }
    const savedSelectedTags = localStorage.getItem("characterSelectedTags");
    if (savedSelectedTags) {
      try {
        this.selectedTags = JSON.parse(savedSelectedTags);
      } catch (error) {
        console.warn("Failed to parse saved selected tags:", error);
        this.selectedTags = [];
      }
    }
    const savedSelectedCast = localStorage.getItem("characterSelectedCast");
    if (savedSelectedCast) {
      this.selectedCast = savedSelectedCast;
    }
    const savedSelectedBook = localStorage.getItem("characterSelectedBook");
    if (savedSelectedBook) {
      this.selectedBook = savedSelectedBook;
    }

    // Register command palette commands
    this.registerCommands();

    // Subscribe to project changes
    this.projectService.currentProject$
      .pipe(takeUntil(this.destroy$))
      .subscribe((project) => {
        this.currentProject = project;
        this.categories = this.projectService.getCategories();
        this.tags = this.projectService.getTags();
        this.casts = this.metadataService.getCasts();
        this.books = this.metadataService.getBooks();

        if (project) {
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

  @HostListener("document:keydown", ["$event"])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Ignore if user is typing in an input, textarea, or select
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"
    ) {
      return;
    }



    // Enter to open selected character
    if (event.key === "Enter" && this.selectedCharacterIndex >= 0) {
      event.preventDefault();
      const selectedCharacter = this.filteredCharacters[this.selectedCharacterIndex];
      if (selectedCharacter) {
        this.editCharacter(selectedCharacter);
      }
      return;
    }

    // N to create new character
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      this.createNewCharacter();
      return;
    }

    // L to toggle list/grid view
    if (event.key === "l" || event.key === "L") {
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
          block: 'nearest'
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
        id: "new-character",
        label: "New Character",
        icon: "➕",
        keywords: ["create", "add", "character"],
        group: "actions",
        action: () => this.createNewCharacter(),
      },
      {
        id: "toggle-view",
        label: `Toggle View (Currently: ${
          this.viewMode === "grid"
            ? "Grid"
            : this.viewMode === "list"
            ? "List"
            : "Compact"
        })`,
        icon:
          this.viewMode === "grid"
            ? "📋"
            : this.viewMode === "list"
            ? "📱"
            : "📄",
        keywords: ["view", "grid", "list", "compact", "toggle", "switch"],
        group: "actions",
        action: () => this.toggleViewMode(),
      },
    ];

    this.commandPaletteService.registerCommands(baseCommands);
  }

  private updateCharacterCommands(characters: Character[]): void {
    // Remove old character commands
    const currentCommands = this.commandPaletteService["commandsSubject"].value;
    const nonCharacterCommands = currentCommands.filter(
      (cmd) => cmd.group !== "characters"
    );

    // Create commands for each character
    const characterCommands = characters.map((character) => ({
      id: `character-${character.id}`,
      label: character.name,
      thumbnail: this.thumbnailDataUrls.get(character.id) || undefined,
      metadata: this.getCategoryName(character.category),
      keywords: [
        character.name,
        this.getCategoryName(character.category),
        ...character.tags.map((tagId) => this.getTagName(tagId)),
        ...character.books.map((bookId) => this.getBookName(bookId)),
      ],
      group: "characters",
      action: () => this.editCharacter(character),
    }));

    // Register all commands
    this.commandPaletteService.registerCommands([
      ...nonCharacterCommands,
      ...characterCommands,
    ]);
  }

  async loadCharacters(): Promise<void> {
    if (!this.currentProject) return;

    try {
      this.isLoading = true;
      this.error = null;
      await this.characterService.loadCharacters(this.currentProject.path);
    } catch (error) {
      this.error = `Failed to load characters: ${error}`;
      console.error("Failed to load characters:", error);
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
      console.error("Failed to refresh characters:", error);
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
      console.error("Failed to scan for characters:", error);
    } finally {
      this.isLoading = false;
    }
  }

  async testLoadSpecificFile(): Promise<void> {
    if (!this.currentProject) return;

    // Prompt user for filename
    const filename = prompt(
      'Enter the exact filename of a character file (e.g., "my-character.md"):'
    );
    if (!filename) return;

    try {
      this.isLoading = true;
      this.error = null;
      const character = await this.characterService.loadSpecificCharacterFile(
        filename
      );

      if (character) {
        alert(`Successfully loaded character: ${character.name}`);
      } else {
        alert(`File not found or failed to load: ${filename}`);
      }
    } catch (error) {
      this.error = `Failed to load specific file: ${error}`;
      console.error("Failed to load specific file:", error);
    } finally {
      this.isLoading = false;
    }
  }

  createNewCharacter(): void {
    this.router.navigate(["/character/new"]);
  }

  editCharacter(character: Character): void {
    this.router.navigate(["/character", character.id]);
  }

  async deleteCharacter(character: Character, event: Event): Promise<void> {
    event.stopPropagation();

    if (
      confirm(
        `Are you sure you want to delete "${character.name}"?\n\nThis action cannot be undone.`
      )
    ) {
      try {
        await this.characterService.deleteCharacter(character.id);
      } catch (error) {
        alert(`Failed to delete character: ${error}`);
      }
    }
  }

  onSearchChange(): void {
    // Save search term to localStorage
    localStorage.setItem("characterSearchTerm", this.searchTerm);
    // Apply filters immediately when search term changes
    this.applyFilters();
  }

  onCategoryChange(): void {
    // Save selected category to localStorage
    localStorage.setItem("characterSelectedCategory", this.selectedCategory);
    this.applyFilters();
  }

  onCategoryToggle(categoryId: string): void {
    // Single selection - set the selected category
    this.selectedCategory = categoryId;
    // Save selected category to localStorage
    localStorage.setItem("characterSelectedCategory", this.selectedCategory);
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
    localStorage.setItem("characterSelectedTags", JSON.stringify(this.selectedTags));
    this.applyFilters();
  }

  onCastChange(): void {
    // Save selected cast to localStorage
    localStorage.setItem("characterSelectedCast", this.selectedCast);
    this.applyFilters();
  }

  onBookChange(): void {
    // Save selected book to localStorage
    localStorage.setItem("characterSelectedBook", this.selectedBook);
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchTerm = "";
    this.selectedCategory = "";
    this.selectedTags = [];
    this.selectedCast = "";
    this.selectedBook = "";
    // Clear saved filter state
    localStorage.removeItem("characterSearchTerm");
    localStorage.removeItem("characterSelectedCategory");
    localStorage.removeItem("characterSelectedTags");
    localStorage.removeItem("characterSelectedCast");
    localStorage.removeItem("characterSelectedBook");
    this.applyFilters();
  }

  clearSearchTerm(): void {
    this.searchTerm = "";
    localStorage.removeItem("characterSearchTerm");
    this.applyFilters();
  }

  private applyFilters(): void {
    this.characters$.pipe(takeUntil(this.destroy$)).subscribe((characters) => {
      this.allCharacters = characters;
      this.filteredCharacters = this.filterAndSortCharacters(characters);
      // Reset selection when filters change
      this.selectedCharacterIndex = -1;
    });
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
        const categoryName = this.getCategoryName(
          character.category
        ).toLowerCase();
        const tagNames = character.tags.map((tagId) =>
          this.getTagName(tagId).toLowerCase()
        );
        const bookNames = character.books.map((bookId) =>
          this.getBookName(bookId).toLowerCase()
        );

        const matchesSearch =
          character.name.toLowerCase().includes(searchLower) ||
          categoryName.includes(searchLower) ||
          tagNames.some((tagName) => tagName.includes(searchLower)) ||
          bookNames.some((bookName) => bookName.includes(searchLower));

        if (!matchesSearch) return false;
      }

      // Category filter
      if (
        this.selectedCategory &&
        character.category !== this.selectedCategory
      ) {
        return false;
      }

      // Tags filter - character must have ALL selected tags
      if (this.selectedTags.length > 0) {
        const hasAllSelectedTags = this.selectedTags.every((tagId) =>
          character.tags.includes(tagId)
        );
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
    return this.categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      tooltip: cat.description || cat.name
    }));
  }

  getTagsAsSelectableItems(): SelectableItem[] {
    return this.tags.map(tag => ({
      id: tag.id,
      name: tag.name,
      color: tag.color
    }));
  }

  onTagsSelectionChange(selectedIds: string[]): void {
    this.selectedTags = selectedIds;
    // Save selected tags to localStorage
    localStorage.setItem("characterSelectedTags", JSON.stringify(this.selectedTags));
    this.applyFilters();
  }

  getTagName(tagId: string): string {
    const tag = this.tags.find((t) => t.id === tagId);
    return tag?.name || tagId;
  }

  getTagColor(tagId: string): string {
    const tag = this.tags.find((t) => t.id === tagId);
    return tag?.color || "#95a5a6";
  }

  getBookName(bookId: string): string {
    const book = this.books.find((b) => b.id === bookId);
    return book?.name || bookId;
  }

  getBookColor(bookId: string): string {
    const book = this.books.find((b) => b.id === bookId);
    return book?.color || "#95a5a6";
  }

  getBookCharacterCount(bookId: string): number {
    // Get all characters (not just filtered ones) to show total count
    return this.allCharacters.filter(character => 
      character.books && character.books.includes(bookId)
    ).length;
  }

  getCharacterTagsInOrder(character: Character): Tag[] {
    // Return tags in the order they appear in the metadata, filtered by what the character has
    return this.tags.filter((tag) => character.tags.includes(tag.id));
  }

  getThumbnailPath(character: Character): string | null {
    if (!character.thumbnail || !this.currentProject) {
      return null;
    }

    // Return the full path to the thumbnail
    return `${this.currentProject.path}/thumbnails/${character.thumbnail}`;
  }

  async getThumbnailDataUrl(character: Character): Promise<string | null> {
    const thumbnailPath = this.getThumbnailPath(character);
    if (!thumbnailPath) {
      return null;
    }

    try {
      return await this.electronService.getImageAsDataUrl(thumbnailPath);
    } catch (error) {
      console.error("Failed to load thumbnail as data URL:", error);
      return null;
    }
  }

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  private async loadThumbnailDataUrls(characters: Character[]): Promise<void> {
    for (const character of characters) {
      if (character.thumbnail && !this.thumbnailDataUrls.has(character.id)) {
        try {
          const dataUrl = await this.getThumbnailDataUrl(character);
          if (dataUrl) {
            this.thumbnailDataUrls.set(character.id, dataUrl);
          }
        } catch (error) {
          console.error(
            `Failed to load thumbnail for character ${character.name}:`,
            error
          );
        }
      }
    }
  }

  getFilterSummary(): string {
    const filters: string[] = [];

    if (this.searchTerm) {
      filters.push(`search: "${this.searchTerm}"`);
    }

    if (this.selectedCategory) {
      const categoryName = this.getCategoryName(this.selectedCategory);
      filters.push(`category: ${categoryName}`);
    }

    if (this.selectedTags.length > 0) {
      const tagNames = this.selectedTags.map((tagId) => this.getTagName(tagId));
      filters.push(`tags: ${tagNames.join(", ")}`);
    }

    if (this.selectedCast) {
      const cast = this.casts.find((c) => c.id === this.selectedCast);
      if (cast) {
        filters.push(`cast: ${cast.name}`);
      }
    }

    if (this.selectedBook) {
      const bookName = this.getBookName(this.selectedBook);
      filters.push(`book: ${bookName}`);
    }

    return filters.length > 0 ? `Filtered by ${filters.join(", ")}` : "";
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = "none";
    }
  }

  toggleViewMode(): void {
    if (this.viewMode === "grid") {
      this.viewMode = "list";
    } else if (this.viewMode === "list") {
      this.viewMode = "compact";
    } else if (this.viewMode === "compact") {
      this.viewMode = "gallery";
    } else {
      this.viewMode = "grid";
    }
    localStorage.setItem("characterViewMode", this.viewMode);
  }

  setViewMode(mode: "grid" | "list" | "compact" | "gallery"): void {
    this.viewMode = mode;
    localStorage.setItem("characterViewMode", this.viewMode);
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
      this.error = "Please select at least one character to create a cast.";
      return;
    }
    this.showCastNameForm = true;
    this.newCastName = "";
    this.error = null;
  }

  cancelCastForm(): void {
    this.showCastNameForm = false;
    this.newCastName = "";
  }

  async saveSelectionAsCast(): Promise<void> {
    if (!this.newCastName || this.newCastName.trim() === "") {
      this.error = "Please enter a name for the cast.";
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
      this.newCastName = "";
      this.error = null;

      // Reload casts
      this.casts = this.metadataService.getCasts();
    } catch (error) {
      this.error = `Failed to create cast: ${error}`;
      console.error("Failed to create cast:", error);
    }
  }

  setSortBy(sortBy: "name" | "category"): void {
    if (this.sortBy === sortBy) {
      // Toggle direction if clicking the same sort
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
    } else {
      // Default to ascending for new sort
      this.sortBy = sortBy;
      this.sortDirection = "asc";
    }

    localStorage.setItem("characterSortBy", this.sortBy);
    localStorage.setItem("characterSortDirection", this.sortDirection);
    this.applyFilters();
  }

  private sortCharacters(characters: Character[]): Character[] {
    const sorted = [...characters];

    if (this.sortBy === "name") {
      sorted.sort((a, b) => {
        const comparison = a.name.localeCompare(b.name);
        return this.sortDirection === "asc" ? comparison : -comparison;
      });
    } else if (this.sortBy === "category") {
      // Sort by category position in the categories array
      sorted.sort((a, b) => {
        const aCategoryIndex = this.categories.findIndex(
          (cat) => cat.id === a.category
        );
        const bCategoryIndex = this.categories.findIndex(
          (cat) => cat.id === b.category
        );

        // If category not found, put at end
        const aIndex = aCategoryIndex === -1 ? 9999 : aCategoryIndex;
        const bIndex = bCategoryIndex === -1 ? 9999 : bCategoryIndex;

        // Primary sort by category order
        const categoryComparison = aIndex - bIndex;

        if (categoryComparison !== 0) {
          return this.sortDirection === "asc"
            ? categoryComparison
            : -categoryComparison;
        }

        // Secondary sort by name within same category
        return a.name.localeCompare(b.name);
      });
    }

    return sorted;
  }
}
