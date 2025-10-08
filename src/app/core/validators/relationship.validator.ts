import { Relationship, GraphNode, GraphData } from '../interfaces/relationship.interface';
import { ValidationResult, ValidationError } from '../interfaces/validation.interface';

export class RelationshipValidator {
  static validateRelationship(relationship: Relationship): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!relationship.id || relationship.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Relationship ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!relationship.source || relationship.source.trim().length === 0) {
      errors.push({
        field: 'source',
        message: 'Source character ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!relationship.target || relationship.target.trim().length === 0) {
      errors.push({
        field: 'target',
        message: 'Target character ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!relationship.type || relationship.type.trim().length === 0) {
      errors.push({
        field: 'type',
        message: 'Relationship type is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!relationship.label || relationship.label.trim().length === 0) {
      errors.push({
        field: 'label',
        message: 'Relationship label is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!relationship.color || relationship.color.trim().length === 0) {
      errors.push({
        field: 'color',
        message: 'Relationship color is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Data type validations
    if (typeof relationship.bidirectional !== 'boolean') {
      errors.push({
        field: 'bidirectional',
        message: 'Bidirectional must be a boolean value',
        code: 'INVALID_TYPE'
      });
    }

    // Self-reference validation
    if (relationship.source === relationship.target) {
      errors.push({
        field: 'target',
        message: 'A character cannot have a relationship with themselves',
        code: 'SELF_REFERENCE'
      });
    }

    // Color format validation (hex color)
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (relationship.color && !hexColorRegex.test(relationship.color)) {
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

  static validateGraphNode(node: GraphNode): ValidationResult {
    const errors: ValidationError[] = [];

    // Required field validations
    if (!node.id || node.id.trim().length === 0) {
      errors.push({
        field: 'id',
        message: 'Node ID is required',
        code: 'REQUIRED_FIELD'
      });
    }

    if (!node.name || node.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message: 'Node name is required',
        code: 'REQUIRED_FIELD'
      });
    }

    // Position validation
    if (!node.position || typeof node.position !== 'object') {
      errors.push({
        field: 'position',
        message: 'Node position is required and must be an object',
        code: 'REQUIRED_FIELD'
      });
    } else {
      if (typeof node.position.x !== 'number' || isNaN(node.position.x)) {
        errors.push({
          field: 'position.x',
          message: 'Position x must be a valid number',
          code: 'INVALID_TYPE'
        });
      }

      if (typeof node.position.y !== 'number' || isNaN(node.position.y)) {
        errors.push({
          field: 'position.y',
          message: 'Position y must be a valid number',
          code: 'INVALID_TYPE'
        });
      }
    }

    // Optional color validation
    if (node.color) {
      const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (!hexColorRegex.test(node.color)) {
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

  static validateGraphData(graphData: GraphData): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate nodes array
    if (!Array.isArray(graphData.nodes)) {
      errors.push({
        field: 'nodes',
        message: 'Nodes must be an array',
        code: 'INVALID_TYPE'
      });
    } else {
      // Validate each node
      graphData.nodes.forEach((node, index) => {
        const nodeValidation = this.validateGraphNode(node);
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
      const nodeIds = graphData.nodes.map(node => node.id);
      const duplicateIds = nodeIds.filter((id, index) => nodeIds.indexOf(id) !== index);
      if (duplicateIds.length > 0) {
        errors.push({
          field: 'nodes',
          message: `Duplicate node IDs found: ${duplicateIds.join(', ')}`,
          code: 'DUPLICATE_ID'
        });
      }
    }

    // Validate edges array
    if (!Array.isArray(graphData.edges)) {
      errors.push({
        field: 'edges',
        message: 'Edges must be an array',
        code: 'INVALID_TYPE'
      });
    } else {
      // Validate each edge
      graphData.edges.forEach((edge, index) => {
        const edgeValidation = this.validateRelationship(edge);
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
      if (Array.isArray(graphData.nodes)) {
        const nodeIds = graphData.nodes.map(node => node.id);
        graphData.edges.forEach((edge, index) => {
          if (!nodeIds.includes(edge.source)) {
            errors.push({
              field: `edges[${index}].source`,
              message: `Source node '${edge.source}' does not exist`,
              code: 'INVALID_REFERENCE'
            });
          }

          if (!nodeIds.includes(edge.target)) {
            errors.push({
              field: `edges[${index}].target`,
              message: `Target node '${edge.target}' does not exist`,
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