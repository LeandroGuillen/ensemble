import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Character } from '../../../../core/interfaces';

@Component({
  selector: 'app-character-gallery-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './character-gallery-view.component.html',
  styleUrls: ['./character-gallery-view.component.scss']
})
export class CharacterGalleryViewComponent {
  @Input() characters: Character[] = [];
  @Input() selectedCharacterIds: string[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();

  @Output() characterClick = new EventEmitter<Character>();
  @Output() characterSelectionToggle = new EventEmitter<string>();

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  isCharacterSelected(characterId: string): boolean {
    return this.selectedCharacterIds.includes(characterId);
  }

  onCharacterClick(character: Character): void {
    this.characterClick.emit(character);
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