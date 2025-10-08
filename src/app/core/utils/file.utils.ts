import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { FileValidationResult } from '../interfaces/validation.interface';

// Promisify fs methods for async/await usage
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

export class FileUtils {
  /**
   * Validates if a file path is safe and within allowed directories
   */
  static validateFilePath(filePath: string, allowedBasePath?: string): FileValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for path traversal attempts
    if (filePath.includes('..')) {
      errors.push('Path traversal detected: file path cannot contain ".."');
    }

    // Check for absolute paths when base path is provided
    if (allowedBasePath && path.isAbsolute(filePath)) {
      warnings.push('Absolute path provided when relative path expected');
    }

    // Check if path is within allowed base path
    if (allowedBasePath) {
      const resolvedPath = path.resolve(allowedBasePath, filePath);
      const resolvedBasePath = path.resolve(allowedBasePath);
      
      if (!resolvedPath.startsWith(resolvedBasePath)) {
        errors.push('File path is outside allowed directory');
      }
    }

    // Check for invalid characters (Windows-specific)
    const invalidChars = /[<>:"|?*]/;
    if (invalidChars.test(filePath)) {
      errors.push('File path contains invalid characters');
    }

    // Check path length (Windows has 260 character limit)
    if (filePath.length > 255) {
      warnings.push('File path is very long and may cause issues on some systems');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Ensures a directory exists, creating it if necessary
   */
  static async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await access(dirPath, fs.constants.F_OK);
    } catch {
      // Directory doesn't exist, create it
      await mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Safely reads a file with error handling
   */
  static async readFileContent(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    try {
      const content = await readFile(filePath, encoding);
      return content;
    } catch (error) {
      if (error instanceof Error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`File not found: ${filePath}`);
        } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          throw new Error(`Permission denied: ${filePath}`);
        } else if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
          throw new Error(`Path is a directory, not a file: ${filePath}`);
        }
      }
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  }

  /**
   * Safely writes content to a file with error handling
   */
  static async writeFileContent(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    try {
      // Ensure the directory exists
      const dirPath = path.dirname(filePath);
      await this.ensureDirectory(dirPath);

      await writeFile(filePath, content, encoding);
    } catch (error) {
      if (error instanceof Error) {
        if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          throw new Error(`Permission denied: ${filePath}`);
        } else if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
          throw new Error(`No space left on device: ${filePath}`);
        }
      }
      throw new Error(`Failed to write file ${filePath}: ${error}`);
    }
  }

  /**
   * Checks if a file exists
   */
  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a path is a directory
   */
  static async isDirectory(dirPath: string): Promise<boolean> {
    try {
      const stats = await stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Lists files in a directory with optional filtering
   */
  static async listFiles(dirPath: string, extension?: string): Promise<string[]> {
    try {
      const files = await readdir(dirPath);
      
      if (extension) {
        return files.filter(file => path.extname(file).toLowerCase() === extension.toLowerCase());
      }
      
      return files;
    } catch (error) {
      if (error instanceof Error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Directory not found: ${dirPath}`);
        } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          throw new Error(`Permission denied: ${dirPath}`);
        }
      }
      throw new Error(`Failed to list files in ${dirPath}: ${error}`);
    }
  }

  /**
   * Safely deletes a file
   */
  static async deleteFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if (error instanceof Error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // File doesn't exist, consider it already deleted
          return;
        } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
          throw new Error(`Permission denied: ${filePath}`);
        }
      }
      throw new Error(`Failed to delete file ${filePath}: ${error}`);
    }
  }

  /**
   * Gets file statistics
   */
  static async getFileStats(filePath: string): Promise<fs.Stats> {
    try {
      return await stat(filePath);
    } catch (error) {
      if (error instanceof Error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`File not found: ${filePath}`);
        }
      }
      throw new Error(`Failed to get file stats for ${filePath}: ${error}`);
    }
  }

  /**
   * Creates a backup of a file before modifying it
   */
  static async createBackup(filePath: string): Promise<string> {
    const backupPath = `${filePath}.backup.${Date.now()}`;
    
    try {
      const content = await this.readFileContent(filePath);
      await this.writeFileContent(backupPath, content);
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup of ${filePath}: ${error}`);
    }
  }

  /**
   * Generates a safe filename from a string
   */
  static sanitizeFilename(filename: string): string {
    // Remove or replace invalid characters
    return filename
      .replace(/[<>:"|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/[^\w\-_.]/g, '') // Keep only word characters, hyphens, underscores, and dots
      .toLowerCase()
      .substring(0, 255); // Limit length
  }

  /**
   * Generates a unique filename if the target already exists
   */
  static async generateUniqueFilename(basePath: string, filename: string): Promise<string> {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    let counter = 1;
    let uniqueFilename = filename;

    while (await this.fileExists(path.join(basePath, uniqueFilename))) {
      uniqueFilename = `${name}-${counter}${ext}`;
      counter++;
    }

    return uniqueFilename;
  }
}