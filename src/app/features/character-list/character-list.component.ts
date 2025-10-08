import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { Character, Category, Tag } from '../../core/interfaces';
import { CharacterService, ProjectService } from '../../core/services';

@Component({
  selector: 'app-character-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './character-list.component.html',
  styleUrls: ['./character-list.component.scss']
})
export class CharacterListComponent implements OnInit {
  characters$: Observable<Character[]>;
  categories: Category[] = [];
  tags: Tag[] = [];
  
  searchTerm = '';
  selectedCategory = '';
  selectedTags: string[] = [];
  
  filteredCharacters: Character[] = [];

  constructor(
    private characterService: CharacterService,
    private projectService: ProjectService,
    private router: Router
  ) {
    this.characters$ = this.characterService.getCharacters();
  }

  ngOnInit(): void {
    this.categories = this.projectService.getCategories();
    this.tags = this.projectService.getTags();
    
    this.characters$.subscribe(characters => {
      this.filteredCharacters = this.filterCharacters(characters);
    });
  }

  createNewCharacter(): void {
    this.router.navigate(['/character']);
  }

  editCharacter(character: Character): void {
    this.router.navigate(['/character', character.id]);
  }

  async deleteCharacter(character: Character): Promise<void> {
    if (confirm(`Are you sure you want to delete "${character.name}"?`)) {
      await this.characterService.deleteCharacter(character.id);
    }
  }

  onSearchChange(): void {
    this.characters$.subscribe(characters => {
      this.filteredCharacters = this.filterCharacters(characters);
    });
  }

  onCategoryChange(): void {
    this.onSearchChange();
  }

  onTagToggle(tagId: string): void {
    const index = this.selectedTags.indexOf(tagId);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tagId);
    }
    this.onSearchChange();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedCategory = '';
    this.selectedTags = [];
    this.onSearchChange();
  }

  private filterCharacters(characters: Character[]): Character[] {
    return characters.filter(character => {
      // Search term filter
      if (this.searchTerm) {
        const searchLower = this.searchTerm.toLowerCase();
        const matchesSearch = 
          character.name.toLowerCase().includes(searchLower) ||
          character.description.toLowerCase().includes(searchLower) ||
          character.notes.toLowerCase().includes(searchLower) ||
          character.tags.some(tag => tag.toLowerCase().includes(searchLower));
        
        if (!matchesSearch) return false;
      }
      
      // Category filter
      if (this.selectedCategory && character.category !== this.selectedCategory) {
        return false;
      }
      
      // Tags filter
      if (this.selectedTags.length > 0) {
        const hasSelectedTag = this.selectedTags.some(tagId => 
          character.tags.includes(tagId)
        );
        if (!hasSelectedTag) return false;
      }
      
      return true;
    });
  }

  getCategoryName(categoryId: string): string {
    const category = this.categories.find(cat => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getTagName(tagId: string): string {
    const tag = this.tags.find(t => t.id === tagId);
    return tag?.name || tagId;
  }
}