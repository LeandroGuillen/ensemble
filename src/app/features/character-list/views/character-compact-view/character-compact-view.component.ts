import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { Character, Tag, Category } from '../../../../core/interfaces';

@Component({
  selector: 'app-character-compact-view',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: './character-compact-view.component.html',
  styleUrls: ['./character-compact-view.component.scss']
})
export class CharacterCompactViewComponent {
  @Input() characters: Character[] = [];
  @Input() categories: Category[] = [];
  @Input() tags: Tag[] = [];
  @Input() columns: 1 | 2 = 2;
  @Input() selectedCharacterIndex = -1;
  @Input() dndEnabled = false;
  @Input() selectedCharacterIds: string[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();

  @Output() characterClick = new EventEmitter<Character>();
  @Output() characterDelete = new EventEmitter<{ character: Character; event: Event }>();
  @Output() characterSelectionToggle = new EventEmitter<string>();
  @Output() dragStarted = new EventEmitter<void>();
  @Output() dragEnded = new EventEmitter<void>();
  private dragInProgress = false;

  getCharacterLink(character: Character): string[] {
    return ['/character', encodeURIComponent(character.id)];
  }

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
    if (this.dragInProgress) {
      return;
    }
    this.characterClick.emit(character);
  }

  onCharacterClickWithStop(character: Character, event: Event): void {
    event.stopPropagation();
    if (this.dragInProgress) {
      return;
    }
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

  onDragStarted(): void {
    this.dragInProgress = true;
    this.dragStarted.emit();
  }

  onDragEnded(): void {
    setTimeout(() => {
      this.dragInProgress = false;
      this.dragEnded.emit();
    }, 0);
  }

  getPlaceholderColor(character: Character): string {
    if (character.tags && character.tags.length > 0) {
      const firstTagId = character.tags[0];
      const tag = this.tags.find(t => t.id === firstTagId);
      if (tag?.color) {
        return tag.color;
      }
    }
    return '#6b7280'; // Default gray
  }
}