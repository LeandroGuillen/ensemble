import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, combineLatest } from 'rxjs';
import { takeUntil, map, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { Character, Category, Tag, Project } from '../../core/interfaces';
import { CharacterService, ProjectService, ElectronService } from '../../core/services';

@Component({
  selector: 'app-character-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './character-list.component.html',
  styleUrls: ['./character-list.component.scss']
})
export class CharacterListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  characters$: Observable<Character[]>;
  categories: Category[] = [];
  tags: Tag[] = [];
  currentProject: Project | null = null;
  
  searchTerm = '';
  selectedCategory = '';
  selectedTags: string[] = [];
  
  filteredCharacters: Character[] = [];
  thumbnailDataUrls: Map<string, string> = new Map();
  isLoading = false;
  error: string | null = null;

  constructor(
    private characterService: CharacterService,
    private projectService: ProjectService,
    private electronService: ElectronService,
    private router: Router
  ) {
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
    // Subscribe to project changes
    this.projectService.currentProject$
      .pipe(takeUntil(this.destroy$))
      .subscribe(project => {
        this.currentProject = project;
        this.categories = this.projectService.getCategories();
        this.tags = this.projectService.getTags();
        
        if (project) {
          this.loadCharacters();
        }
      });
    
    // Subscribe to character changes and apply filters
    this.characters$
      .pipe(takeUntil(this.destroy$))
      .subscribe(characters => {
        this.filteredCharacters = this.filterCharacters(characters);
        this.loadThumbnailDataUrls(characters);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
      const foundCount = await this.characterService.scanForExistingCharacters();
      
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
    this.router.navigate(['/character', character.id]);
  }

  async deleteCharacter(character: Character, event: Event): Promise<void> {
    event.stopPropagation();
    
    if (confirm(`Are you sure you want to delete "${character.name}"?\n\nThis action cannot be undone.`)) {
      try {
        await this.characterService.deleteCharacter(character.id);
      } catch (error) {
        alert(`Failed to delete character: ${error}`);
      }
    }
  }

  onSearchChange(): void {
    // Apply filters immediately when search term changes
    this.applyFilters();
  }

  onCategoryChange(): void {
    this.applyFilters();
  }

  onTagToggle(tagId: string): void {
    const index = this.selectedTags.indexOf(tagId);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tagId);
    }
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = '';
    this.selectedTags = [];
    this.applyFilters();
  }

  private applyFilters(): void {
    this.characters$.pipe(takeUntil(this.destroy$)).subscribe(characters => {
      this.filteredCharacters = this.filterCharacters(characters);
    });
  }

  private filterCharacters(characters: Character[]): Character[] {
    return characters.filter(character => {
      // Search term filter - search across names, categories, tags, and descriptions
      if (this.searchTerm) {
        const searchLower = this.searchTerm.toLowerCase();
        const categoryName = this.getCategoryName(character.category).toLowerCase();
        const tagNames = character.tags.map(tagId => this.getTagName(tagId).toLowerCase());
        
        const matchesSearch = 
          character.name.toLowerCase().includes(searchLower) ||
          character.description.toLowerCase().includes(searchLower) ||
          character.notes.toLowerCase().includes(searchLower) ||
          categoryName.includes(searchLower) ||
          tagNames.some(tagName => tagName.includes(searchLower));
        
        if (!matchesSearch) return false;
      }
      
      // Category filter
      if (this.selectedCategory && character.category !== this.selectedCategory) {
        return false;
      }
      
      // Tags filter - character must have ALL selected tags
      if (this.selectedTags.length > 0) {
        const hasAllSelectedTags = this.selectedTags.every(tagId => 
          character.tags.includes(tagId)
        );
        if (!hasAllSelectedTags) return false;
      }
      
      return true;
    });
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find(cat => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find(cat => cat.id === categoryId);
    return category?.color || '#95a5a6';
  }

  getTagName(tagId: string): string {
    const tag = this.tags.find(t => t.id === tagId);
    return tag?.name || tagId;
  }

  getTagColor(tagId: string): string {
    const tag = this.tags.find(t => t.id === tagId);
    return tag?.color || '#95a5a6';
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
      console.error('Failed to load thumbnail as data URL:', error);
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
          console.error(`Failed to load thumbnail for character ${character.name}:`, error);
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
      const tagNames = this.selectedTags.map(tagId => this.getTagName(tagId));
      filters.push(`tags: ${tagNames.join(', ')}`);
    }
    
    return filters.length > 0 ? `Filtered by ${filters.join(', ')}` : '';
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }
}