import { ProjectMetadata, Category, Tag, ProjectSettings } from '../interfaces/project.interface';
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

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}