import { ProjectMetadata, Category, Tag, ProjectSettings, Book, Series, Saga } from '../interfaces/project.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UNICODE_KEBAB_CASE_REGEX = /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u;
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

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

    // Series validation (optional array)
    if (metadata.series !== undefined && metadata.series !== null && !Array.isArray(metadata.series)) {
      errors.push({
        field: 'series',
        message: 'Series must be an array',
        code: 'INVALID_TYPE'
      });
    } else if (metadata.series) {
      metadata.series.forEach((series, index) => {
        const seriesValidation = this.validateSeries(series);
        if (!seriesValidation.isValid) {
          seriesValidation.errors.forEach(error => {
            errors.push({
              field: `series[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }
      });

      const seriesIds = metadata.series.map(s => s.id);
      const duplicateSeriesIds = seriesIds.filter((id, index) => seriesIds.indexOf(id) !== index);
      if (duplicateSeriesIds.length > 0) {
        errors.push({
          field: 'series',
          message: `Duplicate series IDs found: ${[...new Set(duplicateSeriesIds)].join(', ')}`,
          code: 'DUPLICATE_ID'
        });
      }
    }

    // Sagas validation (optional array)
    if (metadata.sagas !== undefined && metadata.sagas !== null && !Array.isArray(metadata.sagas)) {
      errors.push({
        field: 'sagas',
        message: 'Sagas must be an array',
        code: 'INVALID_TYPE'
      });
    } else if (metadata.sagas) {
      const seriesIdSet = new Set((metadata.series || []).map(s => s.id));

      metadata.sagas.forEach((saga, index) => {
        const sagaValidation = this.validateSaga(saga);
        if (!sagaValidation.isValid) {
          sagaValidation.errors.forEach(error => {
            errors.push({
              field: `sagas[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }

        if (saga.seriesId && !seriesIdSet.has(saga.seriesId)) {
          errors.push({
            field: `sagas[${index}].seriesId`,
            message: `Saga series '${saga.seriesId}' does not exist`,
            code: 'INVALID_REFERENCE'
          });
        }
      });

      const sagaIds = metadata.sagas.map(s => s.id);
      const duplicateSagaIds = sagaIds.filter((id, index) => sagaIds.indexOf(id) !== index);
      if (duplicateSagaIds.length > 0) {
        errors.push({
          field: 'sagas',
          message: `Duplicate saga IDs found: ${[...new Set(duplicateSagaIds)].join(', ')}`,
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
      const seriesIdSet = new Set((metadata.series || []).map(s => s.id));
      const sagaById = new Map((metadata.sagas || []).map(s => [s.id, s]));

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

        if (book.seriesId) {
          if (!seriesIdSet.has(book.seriesId)) {
            errors.push({
              field: `books[${index}].seriesId`,
              message: `Book series '${book.seriesId}' does not exist`,
              code: 'INVALID_REFERENCE'
            });
          }
        }

        if (book.sagaId) {
          const saga = sagaById.get(book.sagaId);
          if (!saga) {
            errors.push({
              field: `books[${index}].sagaId`,
              message: `Book saga '${book.sagaId}' does not exist`,
              code: 'INVALID_REFERENCE'
            });
          } else if (book.seriesId && book.seriesId !== saga.seriesId) {
            errors.push({
              field: `books[${index}].sagaId`,
              message: `Book saga '${book.sagaId}' belongs to series '${saga.seriesId}', not '${book.seriesId}'`,
              code: 'INVALID_REFERENCE'
            });
          } else if (!book.seriesId) {
            errors.push({
              field: `books[${index}].seriesId`,
              message: `Book with saga '${book.sagaId}' must also set seriesId to '${saga.seriesId}'`,
              code: 'INVALID_REFERENCE'
            });
          }
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

      // Check for duplicate book codes (case-insensitive, only when set)
      const bookCodes = metadata.books
        .map(book => book.code?.trim().toLowerCase())
        .filter((code): code is string => !!code);
      const duplicateBookCodes = bookCodes.filter((code, index) => bookCodes.indexOf(code) !== index);
      if (duplicateBookCodes.length > 0) {
        errors.push({
          field: 'books',
          message: `Duplicate book codes found: ${[...new Set(duplicateBookCodes)].join(', ')}`,
          code: 'DUPLICATE_CODE'
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

    if (category.id && !KEBAB_CASE_REGEX.test(category.id)) {
      errors.push({
        field: 'id',
        message: 'Category ID must be in kebab-case format (e.g., main-character)',
        code: 'INVALID_FORMAT'
      });
    }

    if (category.color && !HEX_COLOR_REGEX.test(category.color)) {
      errors.push({
        field: 'color',
        message: 'Color must be a valid hex color (e.g., #FF0000)',
        code: 'INVALID_FORMAT'
      });
    }

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

    if (tag.id && !UNICODE_KEBAB_CASE_REGEX.test(tag.id)) {
      errors.push({
        field: 'id',
        message: 'Tag ID must be in kebab-case format (e.g., magic-user)',
        code: 'INVALID_FORMAT'
      });
    }

    if (tag.color && !HEX_COLOR_REGEX.test(tag.color)) {
      errors.push({
        field: 'color',
        message: 'Color must be a valid hex color (e.g., #FF0000)',
        code: 'INVALID_FORMAT'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateSeries(series: Series): ValidationResult {
    const errors: ValidationError[] = [];

    if (!series.id || series.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Series ID is required',
        code: 'REQUIRED_FIELD'
      });
    } else if (!KEBAB_CASE_REGEX.test(series.id)) {
      errors.push({
        field: 'id',
        message: 'Series ID must be in kebab-case format (e.g., harry-potter)',
        code: 'INVALID_FORMAT'
      });
    }

    if (!series.name || series.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Series name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (series.description && series.description.length > 1000) {
      errors.push({
        field: 'description',
        message: 'Series description must be 1000 characters or less',
        code: 'INVALID_LENGTH'
      });
    }

    if (series.color && !HEX_COLOR_REGEX.test(series.color)) {
      errors.push({
        field: 'color',
        message: 'Color must be a valid hex color (e.g., #FF0000)',
        code: 'INVALID_FORMAT'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateSaga(saga: Saga): ValidationResult {
    const errors: ValidationError[] = [];

    if (!saga.id || saga.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Saga ID is required',
        code: 'REQUIRED_FIELD'
      });
    } else if (!KEBAB_CASE_REGEX.test(saga.id)) {
      errors.push({
        field: 'id',
        message: 'Saga ID must be in kebab-case format (e.g., zamasu-saga)',
        code: 'INVALID_FORMAT'
      });
    }

    if (!saga.name || saga.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Saga name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!saga.seriesId || saga.seriesId.trim().length === 0) {
      errors.push({
        field: 'seriesId',
        message: 'Saga must belong to a series',
        code: 'REQUIRED_FIELD'
      });
    } else if (!KEBAB_CASE_REGEX.test(saga.seriesId)) {
      errors.push({
        field: 'seriesId',
        message: 'Saga series ID must be in kebab-case format',
        code: 'INVALID_FORMAT'
      });
    }

    if (saga.description && saga.description.length > 1000) {
      errors.push({
        field: 'description',
        message: 'Saga description must be 1000 characters or less',
        code: 'INVALID_LENGTH'
      });
    }

    if (saga.color && !HEX_COLOR_REGEX.test(saga.color)) {
      errors.push({
        field: 'color',
        message: 'Color must be a valid hex color (e.g., #FF0000)',
        code: 'INVALID_FORMAT'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateBook(book: Book): ValidationResult {
    const errors: ValidationError[] = [];

    if (!book.id || book.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Book ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    const hasCode = !!(book.code && book.code.trim().length > 0);
    const hasName = !!(book.name && book.name.trim().length > 0);
    if (!hasCode && !hasName) {
      errors.push({
        field: 'name',
        message: 'Either book code or title is required',
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

    if (book.id && !KEBAB_CASE_REGEX.test(book.id)) {
      errors.push({
        field: 'id',
        message: 'Book ID must be in kebab-case format (e.g., first-chronicle)',
        code: 'INVALID_FORMAT'
      });
    }

    if (book.color && !HEX_COLOR_REGEX.test(book.color)) {
      errors.push({
        field: 'color',
        message: 'Color must be a valid hex color (e.g., #FF0000)',
        code: 'INVALID_FORMAT'
      });
    }

    if (book.code && book.code.trim().length > 50) {
      errors.push({
        field: 'code',
        message: 'Book code must be 50 characters or less',
        code: 'INVALID_LENGTH'
      });
    }

    if (book.description && book.description.length > 1000) {
      errors.push({
        field: 'description',
        message: 'Book description must be 1000 characters or less',
        code: 'INVALID_LENGTH'
      });
    }

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

    if (book.publicationDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(book.publicationDate)) {
        errors.push({
          field: 'publicationDate',
          message: 'Publication date must be in YYYY-MM-DD format',
          code: 'INVALID_FORMAT'
        });
      } else {
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

    if (book.povCharacterIds !== undefined && book.povCharacterIds !== null) {
      if (!Array.isArray(book.povCharacterIds)) {
        errors.push({
          field: 'povCharacterIds',
          message: 'PoV character IDs must be an array',
          code: 'INVALID_TYPE'
        });
      } else if (book.povCharacterIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
        errors.push({
          field: 'povCharacterIds',
          message: 'PoV character IDs must be non-empty strings',
          code: 'INVALID_VALUE'
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

    if (!settings.defaultCategory || settings.defaultCategory.trim().length === 0) {
      errors.push({
        field: 'defaultCategory',
        message: 'Default category is required',
        code: 'REQUIRED_FIELD'
      });
    }

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

    if (settings.imagesFolder !== undefined && settings.imagesFolder !== null) {
      if (typeof settings.imagesFolder !== 'string') {
        errors.push({
          field: 'imagesFolder',
          message: 'Images folder must be a string',
          code: 'INVALID_TYPE'
        });
      } else if (settings.imagesFolder.includes('..')) {
        errors.push({
          field: 'imagesFolder',
          message: 'Images folder cannot contain parent path (..)',
          code: 'INVALID_VALUE'
        });
      } else if (/[<>:"|?*]/.test(settings.imagesFolder)) {
        errors.push({
          field: 'imagesFolder',
          message: 'Images folder contains invalid characters',
          code: 'INVALID_VALUE'
        });
      }
    }

    if (settings.characterStyles !== undefined && settings.characterStyles !== null) {
      if (!Array.isArray(settings.characterStyles)) {
        errors.push({
          field: 'characterStyles',
          message: 'Character styles must be an array',
          code: 'INVALID_TYPE'
        });
      } else {
        const styleIds: string[] = [];
        settings.characterStyles.forEach((style, index) => {
          if (!style || typeof style !== 'object') {
            errors.push({
              field: `characterStyles[${index}]`,
              message: 'Character style must be an object',
              code: 'INVALID_TYPE'
            });
            return;
          }
          if (!style.id || typeof style.id !== 'string' || !style.id.trim()) {
            errors.push({
              field: `characterStyles[${index}].id`,
              message: 'Character style id is required',
              code: 'REQUIRED_FIELD'
            });
          } else {
            styleIds.push(style.id);
          }
          if (!style.name || typeof style.name !== 'string' || !style.name.trim()) {
            errors.push({
              field: `characterStyles[${index}].name`,
              message: 'Character style name is required',
              code: 'REQUIRED_FIELD'
            });
          }
        });
        const duplicateIds = styleIds.filter((id, i) => styleIds.indexOf(id) !== i);
        if (duplicateIds.length > 0) {
          errors.push({
            field: 'characterStyles',
            message: `Duplicate character style ids: ${[...new Set(duplicateIds)].join(', ')}`,
            code: 'DUPLICATE_VALUE'
          });
        }
        if (
          settings.defaultCharacterStyle &&
          styleIds.length > 0 &&
          !styleIds.includes(settings.defaultCharacterStyle)
        ) {
          errors.push({
            field: 'defaultCharacterStyle',
            message: 'Default character style must match a configured style id',
            code: 'INVALID_VALUE'
          });
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
