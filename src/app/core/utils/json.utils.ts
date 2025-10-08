// Note: File I/O methods removed due to Node.js module conflicts in browser environment
// File operations should be handled through ElectronService in this Electron app

export interface JsonParseResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class JsonUtils {
  /**
   * Safely parses JSON string with error handling
   */
  static parseJson<T = any>(jsonString: string): JsonParseResult<T> {
    try {
      const data = JSON.parse(jsonString) as T;
      return {
        success: true,
        data
      };
    } catch (error) {
      return {
        success: false,
        error: `Invalid JSON: ${error}`
      };
    }
  }

  /**
   * Converts object to formatted JSON string
   */
  static stringify<T = any>(data: T, indent: number = 2): string {
    try {
      return JSON.stringify(data, null, indent);
    } catch (error) {
      throw new Error(`Failed to stringify JSON: ${error}`);
    }
  }

  /**
   * Validates JSON file structure against a schema
   */
  static validateJsonStructure<T = any>(
    jsonString: string, 
    validator: (data: any) => data is T
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    try {
      const parseResult = this.parseJson(jsonString);
      
      if (!parseResult.success) {
        errors.push(parseResult.error!);
        return { isValid: false, errors };
      }

      if (!validator(parseResult.data)) {
        errors.push('JSON data does not match expected schema');
      }
    } catch (error) {
      errors.push(`JSON validation failed: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Compares two JSON objects for equality
   */
  static deepEqual<T = any>(obj1: T, obj2: T): boolean {
    try {
      return JSON.stringify(obj1) === JSON.stringify(obj2);
    } catch {
      return false;
    }
  }

  /**
   * Creates a deep copy of a JSON-serializable object
   */
  static deepClone<T = any>(obj: T): T {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      throw new Error(`Failed to deep clone object: ${error}`);
    }
  }

  /**
   * Minifies JSON by removing whitespace
   */
  static minify<T = any>(data: T): string {
    return this.stringify(data, 0);
  }

  /**
   * Prettifies JSON with proper indentation
   */
  static prettify(jsonString: string, indent: number = 2): string {
    try {
      const parsed = JSON.parse(jsonString);
      return this.stringify(parsed, indent);
    } catch (error) {
      throw new Error(`Failed to prettify JSON: ${error}`);
    }
  }

  /**
   * Checks if a string is valid JSON
   */
  static isValidJson(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extracts specific property from JSON object using dot notation
   */
  static getProperty<T = any>(data: any, propertyPath: string): T | undefined {
    try {
      // Simple property path resolution (e.g., "settings.autoSave")
      const properties = propertyPath.split('.');
      let current = data;
      
      for (const prop of properties) {
        if (current && typeof current === 'object' && prop in current) {
          current = current[prop];
        } else {
          return undefined;
        }
      }
      
      return current as T;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Sets a property in an object using dot notation
   */
  static setProperty<T = any>(data: T, propertyPath: string, value: any): T {
    try {
      const properties = propertyPath.split('.');
      const cloned = this.deepClone(data);
      let current = cloned as any;
      
      for (let i = 0; i < properties.length - 1; i++) {
        const prop = properties[i];
        if (!(prop in current) || typeof current[prop] !== 'object') {
          current[prop] = {};
        }
        current = current[prop];
      }
      
      current[properties[properties.length - 1]] = value;
      return cloned;
    } catch (error) {
      throw new Error(`Failed to set property ${propertyPath}: ${error}`);
    }
  }
}