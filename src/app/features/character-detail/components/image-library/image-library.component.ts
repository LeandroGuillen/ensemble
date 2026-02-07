import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Character, CharacterImage } from '../../../../core/interfaces/character.interface';
import { CharacterService } from '../../../../core/services/character.service';
import { ElectronService } from '../../../../core/services/electron.service';
import { ImageCategoryService } from '../../../../core/services/image-category.service';
import { LoggingService } from '../../../../core/services/logging.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-image-library',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './image-library.component.html',
  styleUrls: ['./image-library.component.scss'],
})
export class ImageLibraryComponent implements OnInit, OnDestroy {
  @Input() character!: Character;

  images: CharacterImage[] = [];
  filteredImages: CharacterImage[] = [];
  imagePreviews: Map<string, string> = new Map(); // imageId -> dataUrl
  availableTags: string[] = []; // Predefined tags from ImageCategoryService
  detectedTags: string[] = []; // Auto-detected tags from folder structure
  allTagsForSelection: string[] = []; // Combined: available + detected
  selectedFilterTags: string[] = [];
  isLoading = false;

  // Edit state
  editingImageId: string | null = null;
  editingTags: string[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private characterService: CharacterService,
    private electronService: ElectronService,
    private imageCategoryService: ImageCategoryService,
    private logger: LoggingService
  ) {}

  ngOnInit(): void {
    // Load available image tags
    this.imageCategoryService.imageTags$
      .pipe(takeUntil(this.destroy$))
      .subscribe((tags) => {
        this.availableTags = tags;
        // Re-extract detected tags and update combined list when available tags change
        this.extractDetectedTags();
        this.updateAllTagsForSelection();
      });

    // Initialize images only if character is defined
    if (this.character) {
      this.loadImages();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Loads images from character and generates previews
   */
  async loadImages(): Promise<void> {
    // Handle case where character.images might be undefined
    this.images = this.character.images ? [...this.character.images].sort((a, b) => a.order - b.order) : [];
    this.extractDetectedTags();
    this.updateAllTagsForSelection();
    this.applyFilter();
    await this.loadImagePreviews();
  }

  /**
   * Loads image previews as data URLs
   */
  async loadImagePreviews(): Promise<void> {
    for (const image of this.images) {
      const imagePath = await this.characterService.getImagePath(this.character.id, image.id);
      if (imagePath) {
        const dataUrl = await this.electronService.getImageAsDataUrl(imagePath);
        if (dataUrl) {
          this.imagePreviews.set(image.id, dataUrl);
        }
      }
    }
  }

  /**
   * Opens file dialog to select and add images
   */
  async addImages(): Promise<void> {
    const selectedPaths = await this.electronService.selectImages();
    if (!selectedPaths || selectedPaths.length === 0) {
      return;
    }

    this.isLoading = true;

    try {
      for (const imagePath of selectedPaths) {
        await this.characterService.addImage(this.character.id, imagePath, []);
      }

      // Reload character from service to get updated images
      const updatedCharacter = this.characterService.getCharacterById(this.character.id);
      if (updatedCharacter) {
        this.character = updatedCharacter;
        await this.loadImages();
      }
    } catch (error) {
      this.logger.error('Failed to add images:', error);
      alert(`Failed to add images: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Removes an image
   */
  async removeImage(imageId: string): Promise<void> {
    const image = this.images.find((img) => img.id === imageId);
    if (!image) {
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete this image (${image.filename})?`);
    if (!confirmed) {
      return;
    }

    this.isLoading = true;

    try {
      await this.characterService.removeImage(this.character.id, imageId);

      // Reload character from service
      const updatedCharacter = this.characterService.getCharacterById(this.character.id);
      if (updatedCharacter) {
        this.character = updatedCharacter;
        this.imagePreviews.delete(imageId);
        await this.loadImages();
      }
    } catch (error) {
      this.logger.error('Failed to remove image:', error);
      alert(`Failed to remove image: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Sets an image as primary
   */
  async setPrimaryImage(imageId: string): Promise<void> {
    this.isLoading = true;

    try {
      await this.characterService.setPrimaryImage(this.character.id, imageId);

      // Reload character from service
      const updatedCharacter = this.characterService.getCharacterById(this.character.id);
      if (updatedCharacter) {
        this.character = updatedCharacter;
        await this.loadImages();
      }
    } catch (error) {
      this.logger.error('Failed to set primary image:', error);
      alert(`Failed to set primary image: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Starts editing image tags
   */
  startEditingTags(imageId: string): void {
    const image = this.images.find((img) => img.id === imageId);
    if (image) {
      this.editingImageId = imageId;
      this.editingTags = [...image.tags];
    }
  }

  /**
   * Saves edited tags
   */
  async saveImageTags(imageId: string): Promise<void> {
    this.isLoading = true;

    try {
      await this.characterService.updateImageMetadata(this.character.id, imageId, {
        tags: this.editingTags,
      });

      // Reload character from service
      const updatedCharacter = this.characterService.getCharacterById(this.character.id);
      if (updatedCharacter) {
        this.character = updatedCharacter;
        await this.loadImages();
      }

      this.editingImageId = null;
      this.editingTags = [];
    } catch (error) {
      this.logger.error('Failed to save image tags:', error);
      alert(`Failed to save tags: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Cancels editing tags
   */
  cancelEditingTags(): void {
    this.editingImageId = null;
    this.editingTags = [];
  }

  /**
   * Toggles a tag in the editing state
   */
  toggleEditingTag(tag: string): void {
    const index = this.editingTags.indexOf(tag);
    if (index > -1) {
      this.editingTags.splice(index, 1);
    } else {
      this.editingTags.push(tag);
    }
  }

  /**
   * Checks if a tag is selected in editing state
   */
  isTagSelected(tag: string): boolean {
    return this.editingTags.includes(tag);
  }

  /**
   * Toggles filter tag
   */
  toggleFilterTag(tag: string): void {
    const index = this.selectedFilterTags.indexOf(tag);
    if (index > -1) {
      this.selectedFilterTags.splice(index, 1);
    } else {
      this.selectedFilterTags.push(tag);
    }
    this.applyFilter();
  }

  /**
   * Checks if filter tag is active
   */
  isFilterTagActive(tag: string): boolean {
    return this.selectedFilterTags.includes(tag);
  }

  /**
   * Clears all filter tags
   */
  clearFilter(): void {
    this.selectedFilterTags = [];
    this.applyFilter();
  }

  /**
   * Applies tag filter to images
   */
  applyFilter(): void {
    if (this.selectedFilterTags.length === 0) {
      this.filteredImages = [...this.images];
    } else {
      this.filteredImages = this.images.filter((image) =>
        this.selectedFilterTags.some((tag) => image.tags.includes(tag))
      );
    }
  }

  /**
   * Gets image preview data URL
   */
  getImagePreview(imageId: string): string | null {
    return this.imagePreviews.get(imageId) || null;
  }

  /**
   * Checks if image is primary
   */
  isPrimaryImage(imageId: string): boolean {
    const image = this.images.find((img) => img.id === imageId);
    return image?.isPrimary || false;
  }

  /**
   * Gets display tags for an image
   */
  getImageTags(imageId: string): string[] {
    const image = this.images.find((img) => img.id === imageId);
    return image?.tags || [];
  }

  /**
   * Extracts all auto-detected tags from current images
   */
  private extractDetectedTags(): void {
    const allTags = new Set<string>();

    for (const image of this.images) {
      for (const tag of image.tags) {
        // Only include tags that are NOT in the predefined availableTags list
        if (!this.availableTags.includes(tag)) {
          allTags.add(tag);
        }
      }
    }

    this.detectedTags = Array.from(allTags).sort();
  }

  /**
   * Updates the combined list of all tags for selection (predefined + detected)
   */
  private updateAllTagsForSelection(): void {
    // Combine availableTags and detectedTags, removing duplicates
    const combined = new Set<string>([...this.availableTags, ...this.detectedTags]);
    this.allTagsForSelection = Array.from(combined).sort();
  }

  /**
   * Checks if a tag is auto-detected (from folder structure)
   */
  isDetectedTag(tag: string): boolean {
    return this.detectedTags.includes(tag);
  }

  /**
   * Handles drag start
   */
  onDragStart(event: DragEvent, imageId: string): void {
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('imageId', imageId);
  }

  /**
   * Handles drag over
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  }

  /**
   * Handles drop
   */
  async onDrop(event: DragEvent, targetImageId: string): Promise<void> {
    event.preventDefault();

    const sourceImageId = event.dataTransfer!.getData('imageId');
    if (sourceImageId === targetImageId) {
      return;
    }

    // Find source and target indices
    const sourceIndex = this.filteredImages.findIndex((img) => img.id === sourceImageId);
    const targetIndex = this.filteredImages.findIndex((img) => img.id === targetImageId);

    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    // Reorder in filtered images
    const reorderedImages = [...this.filteredImages];
    const [movedImage] = reorderedImages.splice(sourceIndex, 1);
    reorderedImages.splice(targetIndex, 0, movedImage);

    // Get all image IDs in new order
    const newOrder = reorderedImages.map((img) => img.id);

    this.isLoading = true;

    try {
      await this.characterService.reorderImages(this.character.id, newOrder);

      // Reload character from service
      const updatedCharacter = this.characterService.getCharacterById(this.character.id);
      if (updatedCharacter) {
        this.character = updatedCharacter;
        await this.loadImages();
      }
    } catch (error) {
      this.logger.error('Failed to reorder images:', error);
      alert(`Failed to reorder images: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }
}
