import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Book, Cast, Category, Character, Tag } from '../../core/interfaces';
import { BookSelectorComponent } from '../book-selector/book-selector.component';
import { CastDropdownComponent } from '../cast-dropdown/cast-dropdown.component';
import { CategoryToggleComponent, ToggleOption } from '../category-toggle/category-toggle.component';
import { MultiSelectButtonsComponent, SelectableItem } from '../multi-select-buttons/multi-select-buttons.component';

export interface FilterState {
  searchTerm: string;
  selectedCategory: string;
  selectedTags: string[];
  selectedCast: string;
  selectedBook: string;
}

@Component({
  selector: 'app-character-filter',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CategoryToggleComponent,
    MultiSelectButtonsComponent,
    CastDropdownComponent,
    BookSelectorComponent,
  ],
  templateUrl: './character-filter.component.html',
  styleUrls: ['./character-filter.component.scss'],
})
export class CharacterFilterComponent {
  @Input() categories: Category[] = [];
  @Input() tags: Tag[] = [];
  @Input() casts: Cast[] = [];
  @Input() books: Book[] = [];
  @Input() allCharacters: Character[] = [];
  @Input() searchTerm = '';
  @Input() selectedCategory = '';
  @Input() selectedTags: string[] = [];
  @Input() selectedCast = '';
  @Input() selectedBook = '';
  @Input() isExpanded = false;

  @Output() searchTermChange = new EventEmitter<string>();
  @Output() categoryChange = new EventEmitter<string>();
  @Output() tagsChange = new EventEmitter<string[]>();
  @Output() castChange = new EventEmitter<string>();
  @Output() bookChange = new EventEmitter<string>();
  @Output() clearFilters = new EventEmitter<void>();
  @Output() expandedChange = new EventEmitter<boolean>();

  toggleExpanded(): void {
    this.isExpanded = !this.isExpanded;
    this.expandedChange.emit(this.isExpanded);
  }

  onSearchChange(): void {
    this.searchTermChange.emit(this.searchTerm);
  }

  clearSearchTerm(): void {
    this.searchTerm = '';
    this.searchTermChange.emit(this.searchTerm);
  }

  onCategoryToggle(categoryId: string): void {
    this.categoryChange.emit(categoryId);
  }

  onTagsSelectionChange(selectedIds: string[]): void {
    this.tagsChange.emit(selectedIds);
  }

  onCastDropdownChange(castId: string): void {
    this.castChange.emit(castId);
  }

  onBookChange(): void {
    this.bookChange.emit(this.selectedBook);
  }

  onClearFilters(): void {
    this.clearFilters.emit();
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

  getCategoryName(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getTagName(tagId: string): string {
    const tag = this.tags.find((t) => t.id === tagId);
    return tag?.name || tagId;
  }

  getCastName(castId: string): string {
    const cast = this.casts.find((c) => c.id === castId);
    return cast?.name || castId;
  }

  getBookName(bookId: string): string {
    const book = this.books.find((b) => b.id === bookId);
    return book?.name || bookId;
  }

  getBookCharacterCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const book of this.books) {
      const count = this.allCharacters.filter(
        (character) => character.books && character.books.includes(book.id)
      ).length;
      counts.set(book.id, count);
    }
    return counts;
  }

  getFilterSummary(): string {
    const filters: string[] = [];

    if (this.selectedCategory) {
      filters.push(this.getCategoryName(this.selectedCategory));
    }

    if (this.selectedTags.length > 0 && this.tags?.length) {
      if (this.selectedTags.length <= 3) {
        const tags = this.selectedTags.map(this.getTagName.bind(this)).join(' • ');
        filters.push(tags);
        // filters.push(this.getTagName(this.selectedTags[0]));
      } else {
        filters.push(`${this.selectedTags.length} tags`);
      }
    }

    if (this.selectedCast) {
      filters.push(this.getCastName(this.selectedCast));
    }

    if (this.selectedBook) {
      filters.push(this.getBookName(this.selectedBook));
    }

    return filters.length > 0 ? filters.join(' • ') : 'No filters applied';
  }

  hasActiveFilters(): boolean {
    return !!(this.selectedCategory || this.selectedTags.length > 0 || this.selectedCast || this.selectedBook);
  }
}
