import { ProjectMetadata, Category, Tag, ProjectSettings, Book, Series, Saga } from '../interfaces/project.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UNICODE_KEBAB_CASE_REGEX = /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u;
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISBN_REGEX = /^(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/;
const BOOK_STATUSES = ['draft', 'in-progress', 'published', 'archived'];
const COLOR_FORMAT_MESSAGE = 'Color must be a valid hex color (e.g., #FF0000)';
/** Project-relative folder settings, with the label used in their messages. */
const FOLDER_SETTINGS = [
  ['charactersFolder', 'Characters'],
  ['locationsFolder', 'Locations'],
  ['promptsFolder', 'Prompts'],
  ['castsFolder', 'Casts'],
  ['imagesFolder', 'Images'],
] as const;

const blank = (value: string | undefined | null): boolean => !value || value.trim().length === 0;
const result = (errors: ValidationError[]): ValidationResult => ({ isValid: errors.length === 0, errors });
const duplicates = (values: string[]): string[] => values.filter((value, index) => values.indexOf(value) !== index);

/** Collects errors; `check(failed, …)` adds one when `failed` is true. */
function collector() {
  const errors: ValidationError[] = [];
  const add = (field: string, message: string, code: string) => errors.push({ field, message, code });
  const check = (failed: unknown, field: string, message: string, code: string) => {
    if (failed) add(field, message, code);
  };
  /** Errors of a nested validation, with their fields prefixed (`books[2].` …). */
  const nest = (prefix: string, nested: ValidationResult) =>
    nested.errors.forEach(error => add(`${prefix}${error.field}`, error.message, error.code));
  return { errors, add, check, nest };
}

export class ProjectValidator {
  static validateProjectMetadata(metadata: ProjectMetadata): ValidationResult {
    const { errors, add, check, nest } = collector();

    check(blank(metadata.projectName), 'projectName', 'Project name is required', 'REQUIRED_FIELD');
    check(blank(metadata.version), 'version', 'Project version is required', 'REQUIRED_FIELD');

    if (!Array.isArray(metadata.categories)) {
      add('categories', 'Categories must be an array', 'INVALID_TYPE');
    } else {
      metadata.categories.forEach((category, index) => nest(`categories[${index}].`, this.validateCategory(category)));
      const ids = duplicates(metadata.categories.map(cat => cat.id));
      check(ids.length, 'categories', `Duplicate category IDs found: ${ids.join(', ')}`, 'DUPLICATE_ID');
    }

    if (!Array.isArray(metadata.tags)) {
      add('tags', 'Tags must be an array', 'INVALID_TYPE');
    } else {
      metadata.tags.forEach((tag, index) => nest(`tags[${index}].`, this.validateTag(tag)));
      const ids = duplicates(metadata.tags.map(tag => tag.id));
      check(ids.length, 'tags', `Duplicate tag IDs found: ${ids.join(', ')}`, 'DUPLICATE_ID');
    }

    if (metadata.series != null && !Array.isArray(metadata.series)) {
      add('series', 'Series must be an array', 'INVALID_TYPE');
    } else if (metadata.series) {
      metadata.series.forEach((series, index) => nest(`series[${index}].`, this.validateSeries(series)));
      const ids = duplicates(metadata.series.map(s => s.id));
      check(ids.length, 'series', `Duplicate series IDs found: ${[...new Set(ids)].join(', ')}`, 'DUPLICATE_ID');
    }

    const seriesIds = new Set((Array.isArray(metadata.series) ? metadata.series : []).map(s => s.id));
    if (metadata.sagas != null && !Array.isArray(metadata.sagas)) {
      add('sagas', 'Sagas must be an array', 'INVALID_TYPE');
    } else if (metadata.sagas) {
      metadata.sagas.forEach((saga, index) => {
        nest(`sagas[${index}].`, this.validateSaga(saga));
        check(saga.seriesId && !seriesIds.has(saga.seriesId), `sagas[${index}].seriesId`,
          `Saga series '${saga.seriesId}' does not exist`, 'INVALID_REFERENCE');
      });
      const ids = duplicates(metadata.sagas.map(s => s.id));
      check(ids.length, 'sagas', `Duplicate saga IDs found: ${[...new Set(ids)].join(', ')}`, 'DUPLICATE_ID');
    }

    if (metadata.books && !Array.isArray(metadata.books)) {
      add('books', 'Books must be an array', 'INVALID_TYPE');
    } else if (metadata.books) {
      const sagaById = new Map((metadata.sagas || []).map(s => [s.id, s]));
      metadata.books.forEach((book, index) => {
        nest(`books[${index}].`, this.validateBook(book));
        check(book.seriesId && !seriesIds.has(book.seriesId), `books[${index}].seriesId`,
          `Book series '${book.seriesId}' does not exist`, 'INVALID_REFERENCE');
        if (!book.sagaId) return;
        const saga = sagaById.get(book.sagaId);
        if (!saga) {
          add(`books[${index}].sagaId`, `Book saga '${book.sagaId}' does not exist`, 'INVALID_REFERENCE');
        } else if (book.seriesId && book.seriesId !== saga.seriesId) {
          add(`books[${index}].sagaId`, `Book saga '${book.sagaId}' belongs to series '${saga.seriesId}', not '${book.seriesId}'`, 'INVALID_REFERENCE');
        } else if (!book.seriesId) {
          add(`books[${index}].seriesId`, `Book with saga '${book.sagaId}' must also set seriesId to '${saga.seriesId}'`, 'INVALID_REFERENCE');
        }
      });
      const ids = duplicates(metadata.books.map(book => book.id));
      check(ids.length, 'books', `Duplicate book IDs found: ${ids.join(', ')}`, 'DUPLICATE_ID');
      // Book codes are compared case-insensitively, only when set.
      const codes = duplicates(metadata.books
        .map(book => book.code?.trim().toLowerCase())
        .filter((code): code is string => !!code));
      check(codes.length, 'books', `Duplicate book codes found: ${[...new Set(codes)].join(', ')}`, 'DUPLICATE_CODE');
    }

    if (!metadata.settings || typeof metadata.settings !== 'object') {
      add('settings', 'Settings is required and must be an object', 'REQUIRED_FIELD');
    } else {
      nest('settings.', this.validateProjectSettings(metadata.settings));
      const defaultCategory = metadata.settings.defaultCategory;
      check(Array.isArray(metadata.categories) && defaultCategory && !metadata.categories.some(cat => cat.id === defaultCategory),
        'settings.defaultCategory', `Default category '${defaultCategory}' does not exist in categories`, 'INVALID_REFERENCE');
    }

    check(metadata.version && !SEMVER_REGEX.test(metadata.version), 'version',
      'Version must follow semantic versioning format (e.g., 1.0.0)', 'INVALID_FORMAT');

    return result(errors);
  }

  static validateCategory(category: Category): ValidationResult {
    const { errors, check } = collector();
    check(blank(category.id), 'id', 'Category ID is required', 'REQUIRED_FIELD');
    check(blank(category.name), 'name', 'Category name is required', 'REQUIRED_FIELD');
    check(blank(category.color), 'color', 'Category color is required', 'REQUIRED_FIELD');
    check(category.id && !KEBAB_CASE_REGEX.test(category.id), 'id',
      'Category ID must be in kebab-case format (e.g., main-character)', 'INVALID_FORMAT');
    check(category.color && !HEX_COLOR_REGEX.test(category.color), 'color', COLOR_FORMAT_MESSAGE, 'INVALID_FORMAT');
    check(category.description && category.description.length > 500, 'description',
      'Category description must be 500 characters or less', 'INVALID_LENGTH');
    return result(errors);
  }

  static validateTag(tag: Tag): ValidationResult {
    const { errors, check } = collector();
    check(blank(tag.id), 'id', 'Tag ID is required', 'REQUIRED_FIELD');
    check(blank(tag.name), 'name', 'Tag name is required', 'REQUIRED_FIELD');
    check(blank(tag.color), 'color', 'Tag color is required', 'REQUIRED_FIELD');
    check(tag.id && !UNICODE_KEBAB_CASE_REGEX.test(tag.id), 'id',
      'Tag ID must be in kebab-case format (e.g., magic-user)', 'INVALID_FORMAT');
    check(tag.color && !HEX_COLOR_REGEX.test(tag.color), 'color', COLOR_FORMAT_MESSAGE, 'INVALID_FORMAT');
    return result(errors);
  }

  static validateSeries(series: Series): ValidationResult {
    const { errors, check } = collector();
    check(blank(series.id), 'id', 'Series ID is required', 'REQUIRED_FIELD');
    check(!blank(series.id) && !KEBAB_CASE_REGEX.test(series.id), 'id',
      'Series ID must be in kebab-case format (e.g., harry-potter)', 'INVALID_FORMAT');
    check(blank(series.name), 'name', 'Series name is required', 'REQUIRED_FIELD');
    check(series.description && series.description.length > 1000, 'description',
      'Series description must be 1000 characters or less', 'INVALID_LENGTH');
    check(series.color && !HEX_COLOR_REGEX.test(series.color), 'color', COLOR_FORMAT_MESSAGE, 'INVALID_FORMAT');
    return result(errors);
  }

  static validateSaga(saga: Saga): ValidationResult {
    const { errors, check } = collector();
    check(blank(saga.id), 'id', 'Saga ID is required', 'REQUIRED_FIELD');
    check(!blank(saga.id) && !KEBAB_CASE_REGEX.test(saga.id), 'id',
      'Saga ID must be in kebab-case format (e.g., zamasu-saga)', 'INVALID_FORMAT');
    check(blank(saga.name), 'name', 'Saga name is required', 'REQUIRED_FIELD');
    check(blank(saga.seriesId), 'seriesId', 'Saga must belong to a series', 'REQUIRED_FIELD');
    check(!blank(saga.seriesId) && !KEBAB_CASE_REGEX.test(saga.seriesId), 'seriesId',
      'Saga series ID must be in kebab-case format', 'INVALID_FORMAT');
    check(saga.description && saga.description.length > 1000, 'description',
      'Saga description must be 1000 characters or less', 'INVALID_LENGTH');
    check(saga.color && !HEX_COLOR_REGEX.test(saga.color), 'color', COLOR_FORMAT_MESSAGE, 'INVALID_FORMAT');
    return result(errors);
  }

  static validateBook(book: Book): ValidationResult {
    const { errors, add, check } = collector();
    check(blank(book.id), 'id', 'Book ID is required', 'REQUIRED_FIELD');
    check(blank(book.code) && blank(book.name), 'name', 'Either book code or title is required', 'REQUIRED_FIELD');
    check(blank(book.color), 'color', 'Book color is required', 'REQUIRED_FIELD');
    check(book.id && !KEBAB_CASE_REGEX.test(book.id), 'id',
      'Book ID must be in kebab-case format (e.g., first-chronicle)', 'INVALID_FORMAT');
    check(book.color && !HEX_COLOR_REGEX.test(book.color), 'color', COLOR_FORMAT_MESSAGE, 'INVALID_FORMAT');
    check(book.code && book.code.trim().length > 50, 'code', 'Book code must be 50 characters or less', 'INVALID_LENGTH');
    check(book.description && book.description.length > 1000, 'description',
      'Book description must be 1000 characters or less', 'INVALID_LENGTH');
    check(book.status && !BOOK_STATUSES.includes(book.status), 'status',
      `Status must be one of: ${BOOK_STATUSES.join(', ')}`, 'INVALID_VALUE');
    if (book.publicationDate) {
      if (!DATE_REGEX.test(book.publicationDate)) {
        add('publicationDate', 'Publication date must be in YYYY-MM-DD format', 'INVALID_FORMAT');
      } else {
        check(isNaN(new Date(book.publicationDate).getTime()), 'publicationDate',
          'Publication date must be a valid date', 'INVALID_VALUE');
      }
    }
    check(book.isbn && !ISBN_REGEX.test(book.isbn.replace(/[- ]/g, '')), 'isbn',
      'ISBN must be a valid ISBN-10 or ISBN-13 format', 'INVALID_FORMAT');
    if (book.povCharacterIds != null) {
      if (!Array.isArray(book.povCharacterIds)) {
        add('povCharacterIds', 'PoV character IDs must be an array', 'INVALID_TYPE');
      } else {
        check(book.povCharacterIds.some((id) => typeof id !== 'string' || id.trim().length === 0), 'povCharacterIds',
          'PoV character IDs must be non-empty strings', 'INVALID_VALUE');
      }
    }
    return result(errors);
  }

  static validateProjectSettings(settings: ProjectSettings): ValidationResult {
    const { errors, add, check } = collector();
    check(blank(settings.defaultCategory), 'defaultCategory', 'Default category is required', 'REQUIRED_FIELD');

    for (const [field, label] of FOLDER_SETTINGS) {
      const folder: unknown = settings[field];
      if (folder == null) continue;
      if (typeof folder !== 'string') {
        add(field, `${label} folder must be a string`, 'INVALID_TYPE');
      } else if (folder.includes('..')) {
        add(field, `${label} folder cannot contain parent path (..)`, 'INVALID_VALUE');
      } else if (/[<>:"|?*]/.test(folder)) {
        add(field, `${label} folder contains invalid characters`, 'INVALID_VALUE');
      }
    }

    if (settings.characterStyles != null) {
      if (!Array.isArray(settings.characterStyles)) {
        add('characterStyles', 'Character styles must be an array', 'INVALID_TYPE');
      } else {
        const styleIds: string[] = [];
        settings.characterStyles.forEach((style, index) => {
          if (!style || typeof style !== 'object') {
            add(`characterStyles[${index}]`, 'Character style must be an object', 'INVALID_TYPE');
            return;
          }
          if (!style.id || typeof style.id !== 'string' || !style.id.trim()) {
            add(`characterStyles[${index}].id`, 'Character style id is required', 'REQUIRED_FIELD');
          } else {
            styleIds.push(style.id);
          }
          check(!style.name || typeof style.name !== 'string' || !style.name.trim(), `characterStyles[${index}].name`,
            'Character style name is required', 'REQUIRED_FIELD');
        });
        const ids = duplicates(styleIds);
        check(ids.length, 'characterStyles', `Duplicate character style ids: ${[...new Set(ids)].join(', ')}`, 'DUPLICATE_VALUE');
        check(settings.defaultCharacterStyle && styleIds.length > 0 && !styleIds.includes(settings.defaultCharacterStyle),
          'defaultCharacterStyle', 'Default character style must match a configured style id', 'INVALID_VALUE');
      }
    }

    return result(errors);
  }
}
