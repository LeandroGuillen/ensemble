import { ProjectMetadata, Category, Tag, ProjectSettings, Book } from '../interfaces/project.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';

export class ProjectValidator {
  static validateProjectMetadata(metadata: ProjectMetadata): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!metadata.projectName || metadata.projectName.trim().length === 0) {
      errors.push({
        field: 'projectName',
        message: 'Project name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!metadata.version || metadata.version.trim().length === 0) {
      errors.push({
        field: 'version',
        message: 'Project version is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Array validations
    if (!Array.isArray(metadata.categories)) {
      errors.push({
        field: 'categories',
        message: 'Categories must be an array',
        code: 'INVALID_TYPE'
      });
    } else {
      // Validate each category
      metadata.categories.forEach((category, index) => {
        const categoryValidation = this.validateCategory(category);
        if (!categoryValidation.isValid) {
          categoryValidation.errors.forEach(error => {
            errors.push({
              field: `categories[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }
      });

      // Check for duplicate category IDs
      const categoryIds = metadata.categories.map(cat => cat.id);
      const duplicateCategoryIds = categoryIds.filter((id, index) => categoryIds.indexOf(id) !== index);
      if (duplicateCategoryIds.length > 0) {
        errors.push({
          field: 'categories',
          message: `Duplicate category IDs found: ${duplicateCategoryIds.join(', ')}`,
          code: 'DUPLICATE_ID'
        });
      }
    }

    if (!Array.isArray(metadata.tags)) {
      errors.push({
        field: 'tags',
        message: 'Tags must be an array',
        code: 'INVALID_TYPE'
      });
    } else {
      // Validate each tag
      metadata.tags.forEach((tag, index) => {
        const tagValidation = this.validateTag(tag);
        if (!tagValidation.isValid) {
          tagValidation.errors.forEach(error => {
            errors.push({
              field: `tags[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }
      });

      // Check for duplicate tag IDs
      const tagIds = metadata.tags.map(tag => tag.id);
      const duplicateTagIds = tagIds.filter((id, index) => tagIds.indexOf(id) !== index);
      if (duplicateTagIds.length > 0) {
        errors.push({
          field: 'tags',
          message: `Duplicate tag IDs found: ${duplicateTagIds.join(', ')}`,
          code: 'DUPLICATE_ID'
        });
      }
    }

    // Books validation (optional array)
    if (metadata.books && !Array.isArray(metadata.books)) {
      errors.push({
        field: 'books',
        message: 'Books must be an array',
        code: 'INVALID_TYPE'
      });
    } else if (metadata.books) {
      // Validate each book
      metadata.books.forEach((book, index) => {
        const bookValidation = this.validateBook(book);
        if (!bookValidation.isValid) {
          bookValidation.errors.forEach(error => {
            errors.push({
              field: `books[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }
      });

      // Check for duplicate book IDs
      const bookIds = metadata.books.map(book => book.id);
      const duplicateBookIds = bookIds.filter((id, index) => bookIds.indexOf(id) !== index);
      if (duplicateBookIds.length > 0) {
        errors.push({
          field: 'books',
          message: `Duplicate book IDs found: ${duplicateBookIds.join(', ')}`,
          code: 'DUPLICATE_ID'
        });
      }
    }

    // Settings validation
    if (!metadata.settings || typeof metadata.settings !== 'object') {
      errors.push({
        field: 'settings',
        message: 'Settings is required and must be an object',
        code: 'REQUIRED_FIELD'
      });
    } else {
      const settingsValidation = this.validateProjectSettings(metadata.settings);
      if (!settingsValidation.isValid) {
        settingsValidation.errors.forEach(error => {
          errors.push({
            field: `settings.${error.field}`,
            message: error.message,
            code: error.code
          });
        });
      }

      // Validate default category reference
      if (Array.isArray(metadata.categories) && metadata.settings.defaultCategory) {
        const defaultCategoryExists = metadata.categories.some(cat => cat.id === metadata.settings.defaultCategory);
        if (!defaultCategoryExists) {
          errors.push({
            field: 'settings.defaultCategory',
            message: `Default category '${metadata.settings.defaultCategory}' does not exist in categories`,
            code: 'INVALID_REFERENCE'
          });
        }
      }
    }

    // Version format validation (semantic versioning)
    if (metadata.version) {
      const semverRegex = /^\d+\.\d+\.\d+$/;
      if (!semverRegex.test(metadata.version)) {
        errors.push({
          field: 'version',
          message: 'Version must follow semantic versioning format (e.g., 1.0.0)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateCategory(category: Category): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!category.id || category.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Category ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!category.name || category.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Category name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!category.color || category.color.trim().length === 0) {
      errors.push({
        field: 'color',
        message: 'Category color is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // ID format validation (kebab-case)
    if (category.id) {
      const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!kebabCaseRegex.test(category.id)) {
        errors.push({
          field: 'id',
          message: 'Category ID must be in kebab-case format (e.g., main-character)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    // Color format validation (hex color)
    if (category.color) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexColorRegex.test(category.color)) {
        errors.push({
          field: 'color',
          message: 'Color must be a valid hex color (e.g., #FF0000)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    // Description length validation (optional field)
    if (category.description && category.description.length > 500) {
      errors.push({
        field: 'description',
        message: 'Category description must be 500 characters or less',
        code: 'INVALID_LENGTH'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateTag(tag: Tag): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!tag.id || tag.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Tag ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!tag.name || tag.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Tag name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!tag.color || tag.color.trim().length === 0) {
      errors.push({
        field: 'color',
        message: 'Tag color is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // ID format validation (kebab-case)
    if (tag.id) {
      const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!kebabCaseRegex.test(tag.id)) {
        errors.push({
          field: 'id',
          message: 'Tag ID must be in kebab-case format (e.g., magic-user)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    // Color format validation (hex color)
    if (tag.color) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexColorRegex.test(tag.color)) {
        errors.push({
          field: 'color',
          message: 'Color must be a valid hex color (e.g., #FF0000)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateBook(book: Book): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!book.id || book.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Book ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!book.name || book.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Book name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!book.color || book.color.trim().length === 0) {
      errors.push({
        field: 'color',
        message: 'Book color is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // ID format validation (kebab-case)
    if (book.id) {
      const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!kebabCaseRegex.test(book.id)) {
        errors.push({
          field: 'id',
          message: 'Book ID must be in kebab-case format (e.g., first-chronicle)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    // Color format validation (hex color)
    if (book.color) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexColorRegex.test(book.color)) {
        errors.push({
          field: 'color',
          message: 'Color must be a valid hex color (e.g., #FF0000)',
          code: 'INVALID_FORMAT'
        });
      }
    }

    // Optional field validations
    if (book.description && book.description.length > 1000) {
      errors.push({
        field: 'description',
        message: 'Book description must be 1000 characters or less',
        code: 'INVALID_LENGTH'
      });
    }

    // Status validation
    if (book.status) {
      const validStatuses = ['draft', 'in-progress', 'published', 'archived'];
      if (!validStatuses.includes(book.status)) {
        errors.push({
          field: 'status',
          message: `Status must be one of: ${validStatuses.join(', ')}`,
          code: 'INVALID_VALUE'
        });
      }
    }

    // Publication date format validation (YYYY-MM-DD)
    if (book.publicationDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(book.publicationDate)) {
        errors.push({
          field: 'publicationDate',
          message: 'Publication date must be in YYYY-MM-DD format',
          code: 'INVALID_FORMAT'
        });
      } else {
        // Validate it's a real date
        const date = new Date(book.publicationDate);
        if (isNaN(date.getTime())) {
          errors.push({
            field: 'publicationDate',
            message: 'Publication date must be a valid date',
            code: 'INVALID_VALUE'
          });
        }
      }
    }

    // ISBN validation (basic format check)
    if (book.isbn) {
      const isbnRegex = /^(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/;
      if (!isbnRegex.test(book.isbn.replace(/[- ]/g, ''))) {
        errors.push({
          field: 'isbn',
          message: 'ISBN must be a valid ISBN-10 or ISBN-13 format',
          code: 'INVALID_FORMAT'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateProjectSettings(settings: ProjectSettings): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!settings.defaultCategory || settings.defaultCategory.trim().length === 0) {
      errors.push({
        field: 'defaultCategory',
        message: 'Default category is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Type validations
    if (typeof settings.autoSave !== 'boolean') {
      errors.push({
        field: 'autoSave',
        message: 'Auto save must be a boolean value',
        code: 'INVALID_TYPE'
      });
    }

    if (typeof settings.fileWatchEnabled !== 'boolean') {
      errors.push({
        field: 'fileWatchEnabled',
        message: 'File watch enabled must be a boolean value',
        code: 'INVALID_TYPE'
      });
    }

    // charactersFolder: optional string, no parent path traversal
    if (settings.charactersFolder !== undefined && settings.charactersFolder !== null) {
      if (typeof settings.charactersFolder !== 'string') {
        errors.push({
          field: 'charactersFolder',
          message: 'Characters folder must be a string',
          code: 'INVALID_TYPE'
        });
      } else if (settings.charactersFolder.includes('..')) {
        errors.push({
          field: 'charactersFolder',
          message: 'Characters folder cannot contain parent path (..)',
          code: 'INVALID_VALUE'
        });
      } else if (/[<>:"|?*]/.test(settings.charactersFolder)) {
        errors.push({
          field: 'charactersFolder',
          message: 'Characters folder contains invalid characters',
          code: 'INVALID_VALUE'
        });
      }
    }

    // castsFolder: optional string, relative to project root, no parent path traversal
    if (settings.castsFolder !== undefined && settings.castsFolder !== null) {
      if (typeof settings.castsFolder !== 'string') {
        errors.push({
          field: 'castsFolder',
          message: 'Casts folder must be a string',
          code: 'INVALID_TYPE'
        });
      } else if (settings.castsFolder.includes('..')) {
        errors.push({
          field: 'castsFolder',
          message: 'Casts folder cannot contain parent path (..)',
          code: 'INVALID_VALUE'
        });
      } else if (/[<>:"|?*]/.test(settings.castsFolder)) {
        errors.push({
          field: 'castsFolder',
          message: 'Casts folder contains invalid characters',
          code: 'INVALID_VALUE'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}