import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, NgZone } from "@angular/core";
import { CommonModule } from "@angular/common";
import { DragDropModule } from '@angular/cdk/drag-drop';
import { Character, Tag } from "../../../../core/interfaces";

@Component({
  selector: "app-character-gallery-view",
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: "./character-gallery-view.component.html",
  styleUrls: ["./character-gallery-view.component.scss"],
})
export class CharacterGalleryViewComponent implements OnInit, OnDestroy, OnChanges {
  @Input() characters: Character[] = [];
  @Input() tags: Tag[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();
  @Input() characterImagesDataUrls: Map<string, string[]> = new Map();
  @Input() slideshowEnabled = true;
  @Input() thumbnailSize: 'big' | 'medium' | 'small' = 'big';
  @Input() dndEnabled = false;

  @Output() characterClick = new EventEmitter<Character>();
  @Output() dragStarted = new EventEmitter<void>();
  @Output() dragEnded = new EventEmitter<void>();

  // Slideshow state: Map<characterId, currentImageIndex>
  currentImageIndices: Map<string, number> = new Map();
  imageKeys: Map<string, number> = new Map(); // Force animation retrigger
  fadingCharacters: Set<string> = new Set(); // Track which characters are currently fading
  private characterTimers: Map<string, any> = new Map(); // Individual timer per character
  private readonly SLIDESHOW_BASE_DELAY = 5000; // 5 seconds base delay
  private dragInProgress = false;

  constructor(private ngZone: NgZone) {}

  ngOnInit(): void {
    this.initializeSlideshows();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Restart slideshows when characterImagesDataUrls or slideshowEnabled changes
    if (changes['characterImagesDataUrls'] || changes['slideshowEnabled']) {
      this.stopAllSlideshows();
      this.initializeSlideshows();
    }
  }

  ngOnDestroy(): void {
    this.stopAllSlideshows();
  }

  private initializeSlideshows(): void {
    // Start individual slideshow for each character with multiple images (only if enabled)
    if (this.slideshowEnabled) {
      for (const character of this.characters) {
        const images = this.characterImagesDataUrls.get(character.id);
        if (images && images.length > 1) {
          this.scheduleCharacterSlideshow(character.id);
        }
      }
    }
  }

  private stopAllSlideshows(): void {
    // Clear all character timers
    this.characterTimers.forEach((timer) => clearTimeout(timer));
    this.characterTimers.clear();
  }

  private scheduleCharacterSlideshow(characterId: string): void {
    // Clear any existing timer for this character
    const existingTimer = this.characterTimers.get(characterId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Random delay: 4000-6000ms (full millisecond range for true randomness)
    const randomDelay = 4000 + Math.floor(Math.random() * 2001); // 4000-6000ms

    const timer = setTimeout(() => {
      this.advanceCharacterSlideshow(characterId);
      this.scheduleCharacterSlideshow(characterId); // Schedule next transition for this character
    }, randomDelay);

    this.characterTimers.set(characterId, timer);
  }

  private advanceCharacterSlideshow(characterId: string): void {
    const images = this.characterImagesDataUrls.get(characterId);
    if (images && images.length > 1) {
      // Mark as fading to trigger the CSS class
      this.fadingCharacters.add(characterId);

      const currentIndex = this.currentImageIndices.get(characterId) || 0;

      // Pick a random index that's different from the current one
      let nextIndex: number;
      do {
        nextIndex = Math.floor(Math.random() * images.length);
      } while (nextIndex === currentIndex && images.length > 1);

      this.currentImageIndices.set(characterId, nextIndex);

      // Update key to track image changes
      const currentKey = this.imageKeys.get(characterId) || 0;
      this.imageKeys.set(characterId, currentKey + 1);

      // Remove fade-in class after animation completes (800ms)
      setTimeout(() => {
        this.fadingCharacters.delete(characterId);
      }, 800);
    }
  }

  getImageKey(character: Character): number {
    return this.imageKeys.get(character.id) || 0;
  }

  shouldFadeIn(character: Character): boolean {
    return this.fadingCharacters.has(character.id);
  }

  getCurrentImageUrl(character: Character): string | null {
    // If slideshow is disabled, always show the thumbnail (first image)
    if (!this.slideshowEnabled) {
      return this.thumbnailDataUrls.get(character.id) || null;
    }

    const images = this.characterImagesDataUrls.get(character.id);
    if (images && images.length > 0) {
      const index = this.currentImageIndices.get(character.id) || 0;
      return images[index];
    }
    return this.thumbnailDataUrls.get(character.id) || null;
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
