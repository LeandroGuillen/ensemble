import { Character } from '../interfaces/character.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';
import { ProjectMetadata } from '../interfaces/project.interface';

export class CharacterValidator {
  static validateAgainstMetadata(character: Character, metadata: ProjectMetadata): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate category exists in metadata
    const categoryExists = metadata.categories.some(cat => cat.id === character.category);
    if (!categoryExists && (!character.lore || !!character.category)) {
      errors.push({
        field: 'category',
        message: `Category '${character.category}' does not exist in project metadata`,
        code: 'INVALID_REFERENCE'
      });
    }

    // Validate tags exist in metadata
    character.tags.forEach(tagId => {
      const tagExists = metadata.tags.some(tag => tag.id === tagId);
      if (!tagExists) {
        errors.push({
          field: 'tags',
          message: `Tag '${tagId}' does not exist in project metadata`,
          code: 'INVALID_REFERENCE'
        });
      }
    });

    // Validate book category overrides
    if (character.bookCategories) {
      const bookIds = new Set((metadata.books || []).map((book) => book.id));
      const categoryIds = new Set(metadata.categories.map((cat) => cat.id));
      const assignedBooks = new Set(character.books || []);

      for (const [bookId, categoryId] of Object.entries(character.bookCategories)) {
        if (!bookIds.has(bookId)) {
          errors.push({
            field: 'bookCategories',
            message: `Book '${bookId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        } else if (!assignedBooks.has(bookId)) {
          errors.push({
            field: 'bookCategories',
            message: `Book category override for '${bookId}' is not in the character's books list`,
            code: 'INVALID_REFERENCE',
          });
        }
        if (!categoryIds.has(categoryId)) {
          errors.push({
            field: 'bookCategories',
            message: `Category '${categoryId}' for book '${bookId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        }
      }
    }

    // Validate book tag overrides
    if (character.bookTags) {
      const bookIds = new Set((metadata.books || []).map((book) => book.id));
      const tagIds = new Set(metadata.tags.map((tag) => tag.id));
      const assignedBooks = new Set(character.books || []);

      for (const [bookId, tags] of Object.entries(character.bookTags)) {
        if (!bookIds.has(bookId)) {
          errors.push({
            field: 'bookTags',
            message: `Book '${bookId}' does not exist in project metadata`,
            code: 'INVALID_REFERENCE',
          });
        } else if (!assignedBooks.has(bookId)) {
          errors.push({
            field: 'bookTags',
            message: `Book tag override for '${bookId}' is not in the character's books list`,
            code: 'INVALID_REFERENCE',
          });
        }
        for (const tagId of tags) {
          if (!tagIds.has(tagId)) {
            errors.push({
              field: 'bookTags',
              message: `Tag '${tagId}' for book '${bookId}' does not exist in project metadata`,
              code: 'INVALID_REFERENCE',
            });
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}