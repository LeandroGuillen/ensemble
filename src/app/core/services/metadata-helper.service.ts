import { Injectable } from '@angular/core';
import { ProjectService } from './project.service';

/**
 * Helper service for common metadata lookup operations
 *
 * Eliminates duplicate getCategoryName, getTagColor, etc. methods
 * that appear across multiple components.
 */
@Injectable({
  providedIn: 'root'
})
export class MetadataHelperService {
  constructor(private projectService: ProjectService) {}

  // Category helpers
  getCategoryName(categoryId: string): string {
    const categories = this.projectService.getCategories();
    return categories.find(c => c.id === categoryId)?.name || categoryId;
  }

  getCategoryColor(categoryId: string): string {
    const categories = this.projectService.getCategories();
    return categories.find(c => c.id === categoryId)?.color || '#95a5a6';
  }

  getCategoryTooltip(categoryId: string): string {
    const categories = this.projectService.getCategories();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return categoryId;
    if (category.description) {
      return category.description;
    }
    return category.name;
  }

  // Tag helpers
  getTagName(tagId: string): string {
    const tags = this.projectService.getTags();
    return tags.find(t => t.id === tagId)?.name || tagId;
  }

  getTagColor(tagId: string): string {
    const tags = this.projectService.getTags();
    return tags.find(t => t.id === tagId)?.color || '#95a5a6';
  }

  // Book helpers
  getBookName(bookId: string): string {
    const books = this.projectService.getBooks();
    return books.find(b => b.id === bookId)?.name || bookId;
  }

  getBookColor(bookId: string): string {
    const books = this.projectService.getBooks();
    return books.find(b => b.id === bookId)?.color || '#95a5a6';
  }

  // Cast helpers
  getCastName(castId: string): string {
    const project = this.projectService.getCurrentProject();
    if (!project) return castId;
    const cast = project.metadata.casts?.find(c => c.id === castId);
    return cast?.name || castId;
  }
}
