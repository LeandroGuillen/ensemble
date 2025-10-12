import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Character, CharacterFormData } from '../interfaces/character.interface';
import { Cast, Category, ProjectMetadata, ProjectSettings, Tag } from '../interfaces/project.interface';
import { ValidationResult } from '../interfaces/validation.interface';
import { CharacterValidator } from '../validators/character.validator';
import { ProjectValidator } from '../validators/project.validator';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root',
})
export class MetadataService {
  private metadataSubject = new BehaviorSubject<ProjectMetadata | null>(null);
  public metadata$ = this.metadataSubject.asObservable();
  private currentProjectPath: string | null = null;

  constructor(private electronService: ElectronService, private projectService: ProjectService) {
    // Subscribe to project changes to keep metadata in sync
    this.projectService.currentProject$.subscribe((project) => {
      if (project) {
        this.metadataSubject.next(project.metadata);
        this.currentProjectPath = project.path;
      } else {
        this.metadataSubject.next(null);
        this.currentProjectPath = null;
      }
    });
  }

  /**
   * Gets the current metadata
   */
  getCurrentMetadata(): ProjectMetadata | null {
    return this.metadataSubject.value;
  }

  /**
   * Loads metadata from the specified project path via ProjectService
   */
  async loadMetadata(projectPath: string): Promise<ProjectMetadata> {
    try {
      this.currentProjectPath = projectPath;

      // Get metadata from the current project loaded in ProjectService
      const project = this.projectService.getCurrentProject();
      if (!project || project.path !== projectPath) {
        throw new Error('Project not loaded in ProjectService');
      }

      const metadata = project.metadata;

      // Validate metadata structure
      const validation = ProjectValidator.validateProjectMetadata(metadata);
      if (!validation.isValid) {
        const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
        throw new Error(`Invalid metadata structure: ${errorMessages}`);
      }

      this.metadataSubject.next(metadata);
      return metadata;
    } catch (error) {
      console.error('Failed to load metadata:', error);
      throw new Error(`Failed to load metadata: ${error}`);
    }
  }

  /**
   * Saves metadata via ProjectService (updates ensemble.json)
   */
  async saveMetadata(metadata: ProjectMetadata): Promise<void> {
    if (!this.currentProjectPath) {
      throw new Error('No project path set');
    }

    try {
      // Validate metadata before saving
      const validation = ProjectValidator.validateProjectMetadata(metadata);
      if (!validation.isValid) {
        const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
        throw new Error(`Invalid metadata: ${errorMessages}`);
      }

      // Use ProjectService to update metadata (which saves to ensemble.json)
      await this.projectService.updateMetadata(metadata);

      this.metadataSubject.next(metadata);
    } catch (error) {
      console.error('Failed to save metadata:', error);
      throw new Error(`Failed to save metadata: ${error}`);
    }
  }

  /**
   * Creates default metadata for a new project
   */
  createDefaultMetadata(projectName: string): ProjectMetadata {
    return {
      projectName,
      version: '1.0.0',
      categories: [
        { id: 'main-character', name: 'Main Character', color: '#3498db', description: 'Primary characters central to the story' },
        { id: 'supporting', name: 'Supporting Character', color: '#2ecc71', description: 'Important characters who support the main story' },
        { id: 'antagonist', name: 'Antagonist', color: '#e74c3c', description: 'Characters who oppose the protagonists' },
        { id: 'minor', name: 'Minor Character', color: '#9b59b6', description: 'Characters with smaller roles in the story' },
      ],
      tags: [
        { id: 'magic-user', name: 'Magic User', color: '#9b59b6' },
        { id: 'noble', name: 'Noble', color: '#e91e63' },
        { id: 'warrior', name: 'Warrior', color: '#ff5722' },
        { id: 'scholar', name: 'Scholar', color: '#1abc9c' },
      ],
      casts: [],
      settings: {
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: true,
      },
    };
  }

  // Category Management

  /**
   * Gets all categories from current metadata
   */
  getCategories(): Category[] {
    const metadata = this.metadataSubject.value;
    return metadata?.categories || [];
  }

  /**
   * Gets a category by ID
   */
  getCategoryById(id: string): Category | undefined {
    const categories = this.getCategories();
    return categories.find((cat) => cat.id === id);
  }

  /**
   * Adds a new category
   */
  async addCategory(categoryData: Omit<Category, 'id'>): Promise<Category> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Generate unique ID
    const id = this.generateId(categoryData.name);
    const newCategory: Category = { id, ...categoryData };

    // Validate the new category
    const validation = ProjectValidator.validateCategory(newCategory);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid category: ${errorMessages}`);
    }

    // Check for duplicate ID
    const existingCategory = metadata.categories.find((cat) => cat.id === id);
    if (existingCategory) {
      throw new Error(`Category with ID '${id}' already exists`);
    }

    // Add category and save
    const updatedMetadata = {
      ...metadata,
      categories: [...metadata.categories, newCategory],
    };

    await this.saveMetadata(updatedMetadata);
    return newCategory;
  }

  /**
   * Updates an existing category
   */
  async updateCategory(id: string, updates: Partial<Omit<Category, 'id'>>): Promise<Category> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const categoryIndex = metadata.categories.findIndex((cat) => cat.id === id);
    if (categoryIndex === -1) {
      throw new Error(`Category with ID '${id}' not found`);
    }

    const updatedCategory = { ...metadata.categories[categoryIndex], ...updates };

    // Validate the updated category
    const validation = ProjectValidator.validateCategory(updatedCategory);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid category: ${errorMessages}`);
    }

    // Update category and save
    const updatedCategories = [...metadata.categories];
    updatedCategories[categoryIndex] = updatedCategory;

    const updatedMetadata = {
      ...metadata,
      categories: updatedCategories,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedCategory;
  }

  /**
   * Removes a category
   */
  async removeCategory(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const categoryExists = metadata.categories.some((cat) => cat.id === id);
    if (!categoryExists) {
      throw new Error(`Category with ID '${id}' not found`);
    }

    // Check if this is the default category
    if (metadata.settings.defaultCategory === id) {
      throw new Error('Cannot remove the default category. Please set a different default category first.');
    }

    // Remove category and save
    const updatedMetadata = {
      ...metadata,
      categories: metadata.categories.filter((cat) => cat.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  // Tag Management

  /**
   * Gets all tags from current metadata
   */
  getTags(): Tag[] {
    const metadata = this.metadataSubject.value;
    return metadata?.tags || [];
  }

  /**
   * Gets a tag by ID
   */
  getTagById(id: string): Tag | undefined {
    const tags = this.getTags();
    return tags.find((tag) => tag.id === id);
  }

  /**
   * Adds a new tag
   */
  async addTag(tagData: Omit<Tag, 'id'>): Promise<Tag> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Generate unique ID
    const id = this.generateId(tagData.name);
    const newTag: Tag = { id, ...tagData };

    // Validate the new tag
    const validation = ProjectValidator.validateTag(newTag);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid tag: ${errorMessages}`);
    }

    // Check for duplicate ID
    const existingTag = metadata.tags.find((tag) => tag.id === id);
    if (existingTag) {
      throw new Error(`Tag with ID '${id}' already exists`);
    }

    // Add tag and save
    const updatedMetadata = {
      ...metadata,
      tags: [...metadata.tags, newTag],
    };

    await this.saveMetadata(updatedMetadata);
    return newTag;
  }

  /**
   * Updates an existing tag
   */
  async updateTag(id: string, updates: Partial<Omit<Tag, 'id'>>): Promise<Tag> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const tagIndex = metadata.tags.findIndex((tag) => tag.id === id);
    if (tagIndex === -1) {
      throw new Error(`Tag with ID '${id}' not found`);
    }

    const updatedTag = { ...metadata.tags[tagIndex], ...updates };

    // Validate the updated tag
    const validation = ProjectValidator.validateTag(updatedTag);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid tag: ${errorMessages}`);
    }

    // Update tag and save
    const updatedTags = [...metadata.tags];
    updatedTags[tagIndex] = updatedTag;

    const updatedMetadata = {
      ...metadata,
      tags: updatedTags,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedTag;
  }

  /**
   * Removes a tag
   */
  async removeTag(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const tagExists = metadata.tags.some((tag) => tag.id === id);
    if (!tagExists) {
      throw new Error(`Tag with ID '${id}' not found`);
    }

    // Remove tag and save
    const updatedMetadata = {
      ...metadata,
      tags: metadata.tags.filter((tag) => tag.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  // Cast Management

  /**
   * Gets all casts from current metadata
   */
  getCasts(): Cast[] {
    const metadata = this.metadataSubject.value;
    return metadata?.casts || [];
  }

  /**
   * Gets a cast by ID
   */
  getCastById(id: string): Cast | undefined {
    const casts = this.getCasts();
    return casts.find((cast) => cast.id === id);
  }

  /**
   * Adds a new cast
   */
  async addCast(castData: Omit<Cast, 'id'>): Promise<Cast> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize casts array if it doesn't exist (for backward compatibility)
    const casts = metadata.casts || [];

    // Generate unique ID
    const id = this.generateId(castData.name);
    const newCast: Cast = { id, ...castData };

    // Check for duplicate ID
    const existingCast = casts.find((cast) => cast.id === id);
    if (existingCast) {
      throw new Error(`Cast with ID '${id}' already exists`);
    }

    // Add cast and save
    const updatedMetadata = {
      ...metadata,
      casts: [...casts, newCast],
    };

    await this.saveMetadata(updatedMetadata);
    return newCast;
  }

  /**
   * Updates an existing cast
   */
  async updateCast(id: string, updates: Partial<Omit<Cast, 'id'>>): Promise<Cast> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize casts array if it doesn't exist (for backward compatibility)
    const casts = metadata.casts || [];

    const castIndex = casts.findIndex((cast) => cast.id === id);
    if (castIndex === -1) {
      throw new Error(`Cast with ID '${id}' not found`);
    }

    const updatedCast = { ...casts[castIndex], ...updates };

    // Update cast and save
    const updatedCasts = [...casts];
    updatedCasts[castIndex] = updatedCast;

    const updatedMetadata = {
      ...metadata,
      casts: updatedCasts,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedCast;
  }

  /**
   * Removes a cast
   */
  async removeCast(id: string): Promise<void> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    // Initialize casts array if it doesn't exist (for backward compatibility)
    const casts = metadata.casts || [];

    const castExists = casts.some((cast) => cast.id === id);
    if (!castExists) {
      throw new Error(`Cast with ID '${id}' not found`);
    }

    // Remove cast and save
    const updatedMetadata = {
      ...metadata,
      casts: casts.filter((cast) => cast.id !== id),
    };

    await this.saveMetadata(updatedMetadata);
  }

  // Settings Management

  /**
   * Gets current project settings
   */
  getSettings(): ProjectSettings | null {
    const metadata = this.metadataSubject.value;
    return metadata?.settings || null;
  }

  /**
   * Updates project settings
   */
  async updateSettings(updates: Partial<ProjectSettings>): Promise<ProjectSettings> {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      throw new Error('No metadata loaded');
    }

    const updatedSettings = { ...metadata.settings, ...updates };

    // Validate the updated settings
    const validation = ProjectValidator.validateProjectSettings(updatedSettings);
    if (!validation.isValid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      throw new Error(`Invalid settings: ${errorMessages}`);
    }

    // If defaultCategory is being updated, validate it exists
    if (updates.defaultCategory) {
      const categoryExists = metadata.categories.some((cat) => cat.id === updates.defaultCategory);
      if (!categoryExists) {
        throw new Error(`Default category '${updates.defaultCategory}' does not exist`);
      }
    }

    // Update settings and save
    const updatedMetadata = {
      ...metadata,
      settings: updatedSettings,
    };

    await this.saveMetadata(updatedMetadata);
    return updatedSettings;
  }

  // Validation Methods

  /**
   * Validates character data against current metadata
   */
  validateCharacterAgainstMetadata(character: Character): ValidationResult {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      return {
        isValid: false,
        errors: [
          {
            field: 'metadata',
            message: 'No metadata loaded',
            code: 'NO_METADATA',
          },
        ],
      };
    }

    return CharacterValidator.validateAgainstMetadata(character, metadata);
  }

  /**
   * Validates character form data against current metadata
   */
  validateCharacterFormDataAgainstMetadata(formData: CharacterFormData): ValidationResult {
    const metadata = this.metadataSubject.value;
    if (!metadata) {
      return {
        isValid: false,
        errors: [
          {
            field: 'metadata',
            message: 'No metadata loaded',
            code: 'NO_METADATA',
          },
        ],
      };
    }

    const errors = [];

    // Validate category exists in metadata
    if (formData.category) {
      const categoryExists = metadata.categories.some((cat) => cat.id === formData.category);
      if (!categoryExists) {
        errors.push({
          field: 'category',
          message: `Category '${formData.category}' does not exist in project metadata`,
          code: 'INVALID_REFERENCE',
        });
      }
    }

    // Validate tags exist in metadata
    if (Array.isArray(formData.tags)) {
      formData.tags.forEach((tagId) => {
        const tagExists = metadata.tags.some((tag) => tag.id === tagId);
        if (!tagExists) {
          errors.push({
            field: 'tags',
            message: `Tag '${tagId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gets available category options for character forms
   */
  getCategoryOptions(): { id: string; name: string; color: string }[] {
    return this.getCategories().map((cat) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
    }));
  }

  /**
   * Gets available tag options for character forms
   */
  getTagOptions(): { id: string; name: string; color: string }[] {
    return this.getTags().map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
    }));
  }

  /**
   * Gets the default category ID
   */
  getDefaultCategoryId(): string | null {
    const settings = this.getSettings();
    return settings?.defaultCategory || null;
  }

  // Utility Methods

  /**
   * Generates a kebab-case ID from a name
   */
  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Resets the service state (useful for testing or project switching)
   */
  reset(): void {
    this.metadataSubject.next(null);
    this.currentProjectPath = null;
  }
}
