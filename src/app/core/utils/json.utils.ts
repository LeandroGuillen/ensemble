import { FileUtils } from './file.utils';

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
   * Reads and parses a JSON file from disk
   */
  static async readJsonFile<T = any>(filePath: string): Promise<T> {
    try {
      const content = await FileUtils.readFileContent(filePath);
      const parseResult = this.parseJson<T>(content);
      
      if (!parseResult.success) {
        throw new Error(parseResult.error);
      }
      
      return parseResult.data!;
    } catch (error) {
      throw new Error(`Failed to read JSON file ${filePath}: ${error}`);
    }
  }

  /**
   * Writes object to JSON file with formatting
   */
  static async writeJsonFile<T = any>(filePath: string, data: T, indent: number = 2): Promise<void> {
    try {
      const jsonContent = this.stringify(data, indent);
      await FileUtils.writeFileContent(filePath, jsonContent);
    } catch (error) {
      throw new Error(`Failed to write JSON file ${filePath}: ${error}`);
    }
  }

  /**
   * Reads JSON file with fallback to default value if file doesn't exist
   */
  static async readJsonFileWithDefault<T = any>(filePath: string, defaultValue: T): Promise<T> {
    try {
      const exists = await FileUtils.fileExists(filePath);
      if (!exists) {
        return defaultValue;
      }
      
      return await this.readJsonFile<T>(filePath);
    } catch (error) {
      // If file exists but can't be read/parsed, throw error
      // If file doesn't exist, return default
      const exists = await FileUtils.fileExists(filePath);
      if (exists) {
        throw error;
      }
      return defaultValue;
    }
  }

  /**
   * Updates a JSON file by merging with existing data
   */
  static async updateJsonFile<T extends Record<string, any>>(
    filePath: string, 
    updates: Partial<T>, 
    createIfNotExists: boolean = true
  ): Promise<T> {
    try {
      let existingData: T;
      
      const exists = await FileUtils.fileExists(filePath);
      if (!exists) {
        if (!createIfNotExists) {
          throw new Error(`File does not exist: ${filePath}`);
        }
        existingData = {} as T;
      } else {
        existingData = await this.readJsonFile<T>(filePath);
      }

      const updatedData = { ...existingData, ...updates };
      await this.writeJsonFile(filePath, updatedData);
      
      return updatedData;
    } catch (error) {
      throw new Error(`Failed to update JSON file ${filePath}: ${error}`);
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
   * Creates a backup of a JSON file before modifying it
   */
  static async backupJsonFile(filePath: string): Promise<string> {
    try {
      return await FileUtils.createBackup(filePath);
    } catch (error) {
      throw new Error(`Failed to backup JSON file ${filePath}: ${error}`);
    }
  }

  /**
   * Safely writes JSON file with atomic operation (write to temp file first)
   */
  static async writeJsonFileAtomic<T = any>(filePath: string, data: T, indent: number = 2): Promise<void> {
    const tempFilePath = `${filePath}.tmp.${Date.now()}`;
    
    try {
      // Write to temporary file first
      await this.writeJsonFile(tempFilePath, data, indent);
      
      // Move temp file to target location (atomic on most filesystems)
      const fs = require('fs');
      const { promisify } = require('util');
      const rename = promisify(fs.rename);
      
      await rename(tempFilePath, filePath);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await FileUtils.deleteFile(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
      
      throw new Error(`Failed to write JSON file atomically ${filePath}: ${error}`);
    }
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
   * Extracts specific property from JSON file without loading entire file into memory
   */
  static async getJsonProperty<T = any>(filePath: string, propertyPath: string): Promise<T | undefined> {
    try {
      const data = await this.readJsonFile(filePath);
      
      // Simple property path resolution (e.g., "settings.autoSave")
      const properties = propertyPath.split('.');
      let current = data;
      
      for (const prop of properties) {
        if (current && typeof current === 'object' && prop in current) {
          current = (current as any)[prop];
        } else {
          return undefined;
        }
      }
      
      return current as T;
    } catch (error) {
      throw new Error(`Failed to get property ${propertyPath} from ${filePath}: ${error}`);
    }
  }
}