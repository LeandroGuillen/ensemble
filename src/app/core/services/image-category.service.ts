import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ProjectService } from './project.service';

/**
 * Service for managing image tags/categories for the character image library
 * Image tags are stored in ensemble.json under the 'imageTags' field
 */
@Injectable({
  providedIn: 'root',
})
export class ImageCategoryService {
  private imageTagsSubject = new BehaviorSubject<string[]>([]);
  public imageTags$ = this.imageTagsSubject.asObservable();

  // Default image tags if none are defined
  private readonly DEFAULT_IMAGE_TAGS = [
    'portrait',
    'full-body',
    'action',
    'reference',
    'concept-art',
    'headshot',
    'expression',
    'outfit',
    'weapon',
    'scene',
  ];

  constructor(private projectService: ProjectService) {
    // Subscribe to project changes to update image tags
    this.projectService.currentProject$.subscribe((project) => {
      if (project) {
        this.loadImageTags();
      } else {
        this.imageTagsSubject.next([]);
      }
    });
  }

  /**
   * Gets the current image tags as an observable
   */
  getImageTags(): Observable<string[]> {
    return this.imageTags$;
  }

  /**
   * Gets the current image tags as a value
   */
  getImageTagsValue(): string[] {
    return this.imageTagsSubject.value;
  }

  /**
   * Loads image tags from the current project
   */
  private loadImageTags(): void {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      this.imageTagsSubject.next([]);
      return;
    }

    // Use project's image tags, or initialize with defaults if not present
    const imageTags = project.metadata.imageTags || [...this.DEFAULT_IMAGE_TAGS];
    this.imageTagsSubject.next(imageTags);

    // If project didn't have image tags, save the defaults asynchronously
    // Don't await - this is a background operation
    if (!project.metadata.imageTags) {
      this.saveImageTags(imageTags).catch((error) => {
        console.warn('Failed to save default image tags:', error);
      });
    }
  }

  /**
   * Adds a new image tag
   */
  async addImageTag(tag: string): Promise<void> {
    const currentTags = this.imageTagsSubject.value;

    // Normalize tag (trim, lowercase)
    const normalizedTag = tag.trim().toLowerCase();

    if (!normalizedTag) {
      throw new Error('Tag cannot be empty');
    }

    if (currentTags.includes(normalizedTag)) {
      throw new Error('Tag already exists');
    }

    const updatedTags = [...currentTags, normalizedTag];
    await this.saveImageTags(updatedTags);
    this.imageTagsSubject.next(updatedTags);
  }

  /**
   * Updates an existing image tag
   */
  async updateImageTag(oldTag: string, newTag: string): Promise<void> {
    const currentTags = this.imageTagsSubject.value;

    // Normalize tags
    const normalizedOld = oldTag.trim().toLowerCase();
    const normalizedNew = newTag.trim().toLowerCase();

    if (!normalizedNew) {
      throw new Error('Tag cannot be empty');
    }

    const oldIndex = currentTags.indexOf(normalizedOld);
    if (oldIndex === -1) {
      throw new Error('Tag not found');
    }

    if (normalizedOld !== normalizedNew && currentTags.includes(normalizedNew)) {
      throw new Error('New tag name already exists');
    }

    const updatedTags = [...currentTags];
    updatedTags[oldIndex] = normalizedNew;

    await this.saveImageTags(updatedTags);
    this.imageTagsSubject.next(updatedTags);

    // TODO: Update all characters that use this tag (future enhancement)
  }

  /**
   * Deletes an image tag
   */
  async deleteImageTag(tag: string): Promise<void> {
    const currentTags = this.imageTagsSubject.value;

    const normalizedTag = tag.trim().toLowerCase();
    const updatedTags = currentTags.filter((t) => t !== normalizedTag);

    if (updatedTags.length === currentTags.length) {
      throw new Error('Tag not found');
    }

    await this.saveImageTags(updatedTags);
    this.imageTagsSubject.next(updatedTags);

    // TODO: Remove tag from all characters that use it (future enhancement)
  }

  /**
   * Reorders image tags
   */
  async reorderImageTags(tags: string[]): Promise<void> {
    await this.saveImageTags(tags);
    this.imageTagsSubject.next(tags);
  }

  /**
   * Resets image tags to defaults
   */
  async resetToDefaults(): Promise<void> {
    const defaultTags = [...this.DEFAULT_IMAGE_TAGS];
    await this.saveImageTags(defaultTags);
    this.imageTagsSubject.next(defaultTags);
  }

  /**
   * Saves image tags to ensemble.json
   */
  private async saveImageTags(tags: string[]): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    // Update project metadata
    await this.projectService.updateMetadata({ imageTags: tags });
  }

  /**
   * Gets default image tags
   */
  getDefaultImageTags(): string[] {
    return [...this.DEFAULT_IMAGE_TAGS];
  }
}
