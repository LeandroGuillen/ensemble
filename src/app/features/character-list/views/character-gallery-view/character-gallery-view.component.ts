import { Component, Input, Output, EventEmitter } from "@angular/core";

import { DragDropModule } from '@angular/cdk/drag-drop';
import { Character, Tag } from "../../../../core/interfaces";

@Component({
    selector: "app-character-gallery-view",
    imports: [DragDropModule],
    templateUrl: "./character-gallery-view.component.html",
    styleUrls: ["./character-gallery-view.component.scss"]
})
export class CharacterGalleryViewComponent {
  @Input() characters: Character[] = [];
  @Input() tags: Tag[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();
  @Input() thumbnailSize: 'big' | 'medium' | 'small' = 'big';
  @Input() dndEnabled = false;
  /** Character IDs that are PoV under the current book filter context. */
  @Input() povCharacterIds: Set<string> = new Set();
  /** Color for the PoV badge pill. */
  @Input() povBadgeColor = 'var(--color-accent-primary)';

  @Output() characterClick = new EventEmitter<Character>();
  @Output() dragStarted = new EventEmitter<void>();
  @Output() dragEnded = new EventEmitter<void>();

  private dragInProgress = false;

  isPov(character: Character): boolean {
    return this.povCharacterIds.has(character.id);
  }

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  getCharacterLink(character: Character): string[] {
    return ['/character', encodeURIComponent(character.id)];
  }

  onCharacterClick(character: Character): void {
    if (this.dragInProgress) {
      return;
    }
    this.characterClick.emit(character);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = "none";
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