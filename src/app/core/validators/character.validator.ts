import { Character, CharacterFormData } from '../interfaces/character.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';
import { ProjectMetadata } from '../interfaces/project.interface';

export class CharacterValidator {
  static validateCharacter(character: Character): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!character.name || character.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Character name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!character.id || character.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Character ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!character.category || character.category.trim().length === 0) {
      errors.push({
        field: 'category',
        message: 'Character category is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!character.filePath || character.filePath.trim().length === 0) {
      errors.push({
        field: 'filePath',
        message: 'Character file path is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Data type validations
    if (!Array.isArray(character.tags)) {
      errors.push({
        field: 'tags',
        message: 'Tags must be an array',
        code: 'INVALID_TYPE'
      });
    }

    if (!(character.created instanceof Date) || isNaN(character.created.getTime())) {
      errors.push({
        field: 'created',
        message: 'Created date must be a valid Date object',
        code: 'INVALID_DATE'
      });
    }

    if (!(character.modified instanceof Date) || isNaN(character.modified.getTime())) {
      errors.push({
        field: 'modified',
        message: 'Modified date must be a valid Date object',
        code: 'INVALID_DATE'
      });
    }

    // String length validations
    if (character.name && character.name.length > 255) {
      errors.push({
        field: 'name',
        message: 'Character name must be 255 characters or less',
        code: 'MAX_LENGTH_EXCEEDED'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateCharacterFormData(formData: CharacterFormData): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!formData.name || formData.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Character name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!formData.category || formData.category.trim().length === 0) {
      errors.push({
        field: 'category',
        message: 'Character category is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Data type validations
    if (!Array.isArray(formData.tags)) {
      errors.push({
        field: 'tags',
        message: 'Tags must be an array',
        code: 'INVALID_TYPE'
      });
    }

    // String length validations
    if (formData.name && formData.name.length > 255) {
      errors.push({
        field: 'name',
        message: 'Character name must be 255 characters or less',
        code: 'MAX_LENGTH_EXCEEDED'
      });
    }

    if (formData.mangamaster && formData.mangamaster.length > 20000) {
      errors.push({
        field: 'mangamaster',
        message: 'Mangamaster must be 20,000 characters or less',
        code: 'MAX_LENGTH_EXCEEDED'
      });
    }

    if (formData.description && formData.description.length > 10000) {
      errors.push({
        field: 'description',
        message: 'Description must be 10,000 characters or less',
        code: 'MAX_LENGTH_EXCEEDED'
      });
    }

    if (formData.notes && formData.notes.length > 50000) {
      errors.push({
        field: 'notes',
        message: 'Notes must be 50,000 characters or less',
        code: 'MAX_LENGTH_EXCEEDED'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateAgainstMetadata(character: Character, metadata: ProjectMetadata): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate category exists in metadata
    const categoryExists = metadata.categories.some(cat => cat.id === character.category);
    if (!categoryExists) {
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

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}