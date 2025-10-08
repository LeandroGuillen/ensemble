export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationRule<T> {
  validate(value: T): ValidationResult;
}

export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}