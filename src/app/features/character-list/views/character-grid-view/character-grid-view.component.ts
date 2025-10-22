import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Character, Tag, Category } from '../../../../core/interfaces';

@Component({
  selector: 'app-character-grid-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './character-grid-view.component.html',
  styleUrls: ['./character-grid-view.component.scss']
})
export class CharacterGridViewComponent {
  @Input() characters: Character[] = [];
  @Input() categories: Category[] = [];
  @Input() tags: Tag[] = [];
  @Input() selectedCharacterIndex = -1;
  @Input() selectedCharacterIds: string[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();

  @Output() characterClick = new EventEmitter<Character>();
  @Output() characterDelete = new EventEmitter<{ character: Character; event: Event }>();
  @Output() characterSelectionToggle = new EventEmitter<string>();

  getCategoryName(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const category = this.categories.find((cat) => cat.id === categoryId);
    return category?.color || '#95a5a6';
  }

  getCharacterTagsInOrder(character: Character): Tag[] {
    return this.tags.filter((tag) => character.tags.includes(tag.id));
  }

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  isCharacterSelected(characterId: string): boolean {
    return this.selectedCharacterIds.includes(characterId);
  }

  onCharacterClick(character: Character): void {
    this.characterClick.emit(character);
  }

  onCharacterClickWithStop(character: Character, event: Event): void {
    event.stopPropagation();
    this.characterClick.emit(character);
  }

  onCharacterDelete(character: Character, event: Event): void {
    this.characterDelete.emit({ character, event });
  }

  onCharacterSelectionToggle(characterId: string): void {
    this.characterSelectionToggle.emit(characterId);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }
}