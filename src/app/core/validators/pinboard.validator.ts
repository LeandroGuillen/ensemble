import { PinboardConnection, PinboardPin, PinboardData } from '../interfaces/pinboard.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';

export class PinboardValidator {
  static validateConnection(connection: PinboardConnection): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!connection.id || connection.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Connection ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!connection.source || connection.source.trim().length === 0) {
      errors.push({
        field: 'source',
        message: 'Source character ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!connection.target || connection.target.trim().length === 0) {
      errors.push({
        field: 'target',
        message: 'Target character ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!connection.type || connection.type.trim().length === 0) {
      errors.push({
        field: 'type',
        message: 'Connection type is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!connection.label || connection.label.trim().length === 0) {
      errors.push({
        field: 'label',
        message: 'Connection label is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!connection.color || connection.color.trim().length === 0) {
      errors.push({
        field: 'color',
        message: 'Connection color is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Data type validations
    if (typeof connection.bidirectional !== 'boolean') {
      errors.push({
        field: 'bidirectional',
        message: 'Bidirectional must be a boolean value',
        code: 'INVALID_TYPE'
      });
    }

    // Self-reference validation
    if (connection.source === connection.target) {
      errors.push({
        field: 'target',
        message: 'A character cannot have a connection with themselves',
        code: 'SELF_REFERENCE'
      });
    }

    // Color format validation (hex color)
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (connection.color && !hexColorRegex.test(connection.color)) {
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

  static validatePin(pin: PinboardPin): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!pin.id || pin.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Pin ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!pin.name || pin.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Pin name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Position validation
    if (!pin.position || typeof pin.position !== 'object') {
      errors.push({
        field: 'position',
        message: 'Pin position is required and must be an object',
        code: 'REQUIRED_FIELD'
      });
    } else {
      if (typeof pin.position.x !== 'number' || isNaN(pin.position.x)) {
        errors.push({
          field: 'position.x',
          message: 'Position x must be a valid number',
          code: 'INVALID_TYPE'
        });
      }

      if (typeof pin.position.y !== 'number' || isNaN(pin.position.y)) {
        errors.push({
          field: 'position.y',
          message: 'Position y must be a valid number',
          code: 'INVALID_TYPE'
        });
      }
    }

    // Optional color validation
    if (pin.color) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexColorRegex.test(pin.color)) {
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

  static validatePinboardData(pinboardData: PinboardData): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate nodes array
    if (!Array.isArray(pinboardData.nodes)) {
      errors.push({
        field: 'nodes',
        message: 'Nodes must be an array',
        code: 'INVALID_TYPE'
      });
    } else {
      // Validate each node
      pinboardData.nodes.forEach((node, index) => {
        const nodeValidation = this.validatePin(node);
        if (!nodeValidation.isValid) {
          nodeValidation.errors.forEach(error => {
            errors.push({
              field: `nodes[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }
      });

      // Check for duplicate node IDs
      const nodeIds = pinboardData.nodes.map(node => node.id);
      const duplicateIds = nodeIds.filter((id, index) => nodeIds.indexOf(id) !== index);
      if (duplicateIds.length > 0) {
        errors.push({
          field: 'nodes',
          message: `Duplicate pin IDs found: ${duplicateIds.join(', ')}`,
          code: 'DUPLICATE_ID'
        });
      }
    }

    // Validate edges array
    if (!Array.isArray(pinboardData.edges)) {
      errors.push({
        field: 'edges',
        message: 'Edges must be an array',
        code: 'INVALID_TYPE'
      });
    } else {
      // Validate each edge
      pinboardData.edges.forEach((edge, index) => {
        const edgeValidation = this.validateConnection(edge);
        if (!edgeValidation.isValid) {
          edgeValidation.errors.forEach(error => {
            errors.push({
              field: `edges[${index}].${error.field}`,
              message: error.message,
              code: error.code
            });
          });
        }
      });

      // Validate edge references to nodes
      if (Array.isArray(pinboardData.nodes)) {
        const nodeIds = pinboardData.nodes.map(node => node.id);
        pinboardData.edges.forEach((edge, index) => {
          if (!nodeIds.includes(edge.source)) {
            errors.push({
              field: `edges[${index}].source`,
              message: `Source pin '${edge.source}' does not exist`,
              code: 'INVALID_REFERENCE'
            });
          }

          if (!nodeIds.includes(edge.target)) {
            errors.push({
              field: `edges[${index}].target`,
              message: `Target pin '${edge.target}' does not exist`,
              code: 'INVALID_REFERENCE'
            });
          }
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

