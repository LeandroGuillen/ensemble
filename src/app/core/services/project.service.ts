import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Book,
  Category,
  GraphNode,
  GraphViewState,
  Project,
  ProjectMetadata,
  Relationship,
  Tag,
} from '../interfaces/project.interface';
import { ElectronService } from './electron.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private currentProjectSubject = new BehaviorSubject<Project | null>(null);
  public currentProject$ = this.currentProjectSubject.asObservable();
  private recentProjects: string[] = [];

  constructor(private electronService: ElectronService) {
    this.loadRecentProjects();
  }

  getCurrentProject(): Project | null {
    return this.currentProjectSubject.value;
  }

  getRecentProjects(): string[] {
    return [...this.recentProjects];
  }

  getMostRecentProject(): string | null {
    return this.recentProjects.length > 0 ? this.recentProjects[0] : null;
  }

  /**
   * Opens Electron folder selection dialog
   */
  async selectProject(): Promise<string | null> {
    try {
      return await this.electronService.selectFolder();
    } catch (error) {
      console.error('Failed to open folder selection dialog:', error);
      return null;
    }
  }

  /**
   * Loads an existing project from the file system
   */
  async loadProject(projectPath: string): Promise<Project | null> {
    try {
      // Check if directory exists
      const isDir = await this.electronService.isDirectory(projectPath);
      if (!isDir) {
        throw new Error(`Project path is not a directory: ${projectPath}`);
      }

      // Load ensemble.json (or fallback to metadata.json for migration)
      const ensemblePath = await this.electronService.pathJoin(projectPath, 'ensemble.json');
      const metadataPath = await this.electronService.pathJoin(projectPath, 'metadata.json');
      const ensembleExists = await this.electronService.fileExists(ensemblePath);
      const metadataExists = await this.electronService.fileExists(metadataPath);

      let metadata: ProjectMetadata;
      if (ensembleExists) {
        const result = await this.electronService.readFile(ensemblePath);
        if (!result.success) {
          throw new Error(`Failed to read ensemble.json: ${result.error}`);
        }

        try {
          metadata = JSON.parse(result.content!);

          // Validate metadata structure
          if (!this.isValidMetadata(metadata)) {
            throw new Error('Invalid metadata structure in project');
          }
        } catch (parseError) {
          throw new Error(`Invalid JSON in ensemble.json: ${parseError}`);
        }
      } else if (metadataExists) {
        // Migrate from old metadata.json
        const result = await this.electronService.readFile(metadataPath);
        if (!result.success) {
          throw new Error(`Failed to read metadata: ${result.error}`);
        }

        try {
          metadata = JSON.parse(result.content!);

          // Load relationships.json if it exists
          const relationshipsPath = await this.electronService.pathJoin(projectPath, 'relationships.json');
          const relationshipsExists = await this.electronService.fileExists(relationshipsPath);
          if (relationshipsExists) {
            const relResult = await this.electronService.readFile(relationshipsPath);
            if (relResult.success) {
              const relationshipsData = JSON.parse(relResult.content!);
              metadata.relationships = relationshipsData;
            }
          }

          // Validate metadata structure
          if (!this.isValidMetadata(metadata)) {
            throw new Error('Invalid metadata structure in project');
          }

          // Save as ensemble.json and delete old files
          await this.saveMetadata(projectPath, metadata);
          if (relationshipsExists) {
            const relationshipsPath = await this.electronService.pathJoin(projectPath, 'relationships.json');
            await this.electronService.deleteFile(relationshipsPath);
          }
          await this.electronService.deleteFile(metadataPath);
        } catch (parseError) {
          throw new Error(`Invalid JSON in metadata file: ${parseError}`);
        }
      } else {
        // Create default metadata if it doesn't exist
        const projectName = await this.electronService.pathBasename(projectPath);
        metadata = this.createDefaultMetadata(projectName);
        await this.saveMetadata(projectPath, metadata);
      }

      // Ensure required directories exist
      await this.ensureProjectStructure(projectPath);

      const project: Project = {
        path: projectPath,
        metadata,
      };

      this.currentProjectSubject.next(project);
      this.addToRecentProjects(projectPath);

      return project;
    } catch (error) {
      console.error('Failed to load project:', error);
      throw new Error(`Failed to load project: ${error}`);
    }
  }

  /**
   * Creates a new project with the required directory structure and metadata
   */
  async createProject(projectPath: string, projectName: string): Promise<Project | null> {
    try {
      // Check if directory already exists
      const exists = await this.electronService.fileExists(projectPath);
      if (exists) {
        const isDir = await this.electronService.isDirectory(projectPath);
        if (!isDir) {
          throw new Error(`Path exists but is not a directory: ${projectPath}`);
        }

        // Check if it's already a project (has metadata.json)
        const metadataPath = await this.electronService.pathJoin(projectPath, 'metadata.json');
        const hasMetadata = await this.electronService.fileExists(metadataPath);
        if (hasMetadata) {
          throw new Error(`Directory already contains a project: ${projectPath}`);
        }
      }

      // Create directory structure
      await this.ensureProjectStructure(projectPath);

      // Create default metadata with empty relationships
      const metadata = this.createDefaultMetadata(projectName);
      await this.saveMetadata(projectPath, metadata);

      const project: Project = {
        path: projectPath,
        metadata,
      };

      this.currentProjectSubject.next(project);
      this.addToRecentProjects(projectPath);

      return project;
    } catch (error) {
      console.error('Failed to create project:', error);
      throw new Error(`Failed to create project: ${error}`);
    }
  }

  /**
   * Ensures the project directory structure exists
   */
  private async ensureProjectStructure(projectPath: string): Promise<void> {
    try {
      // Create main project directory
      const mainResult = await this.electronService.createDirectory(projectPath);
      if (!mainResult.success) {
        throw new Error(`Failed to create main directory: ${mainResult.error}`);
      }

      // Create characters subdirectory
      const charactersPath = await this.electronService.pathJoin(projectPath, 'characters');
      const charactersResult = await this.electronService.createDirectory(charactersPath);
      if (!charactersResult.success) {
        throw new Error(`Failed to create characters directory: ${charactersResult.error}`);
      }

      // Create thumbnails subdirectory
      const thumbnailsPath = await this.electronService.pathJoin(projectPath, 'thumbnails');
      const thumbnailsResult = await this.electronService.createDirectory(thumbnailsPath);
      if (!thumbnailsResult.success) {
        throw new Error(`Failed to create thumbnails directory: ${thumbnailsResult.error}`);
      }
    } catch (error) {
      throw new Error(`Failed to create project structure: ${error}`);
    }
  }

  /**
   * Creates default metadata for a new project
   */
  private createDefaultMetadata(projectName: string): ProjectMetadata {
    return {
      projectName,
      version: '1.0.0',
      categories: [
        { id: 'main-character', name: 'Main Character', color: '#3498db' },
        { id: 'supporting', name: 'Supporting Character', color: '#2ecc71' },
        { id: 'antagonist', name: 'Antagonist', color: '#e74c3c' },
        { id: 'minor', name: 'Minor Character', color: '#9b59b6' },
      ],
      tags: [
        { id: 'magic-user', name: 'Magic User', color: '#9b59b6' },
        { id: 'noble', name: 'Noble', color: '#f39c12' },
        { id: 'warrior', name: 'Warrior', color: '#ff5722' },
        { id: 'scholar', name: 'Scholar', color: '#1abc9c' },
      ],
      casts: [],
      books: [],
      settings: {
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: true,
      },
      relationships: {
        nodes: [],
        edges: [],
      },
    };
  }

  /**
   * Saves metadata to the project's ensemble.json file
   */
  private async saveMetadata(projectPath: string, metadata: ProjectMetadata): Promise<void> {
    const ensemblePath = await this.electronService.pathJoin(projectPath, 'ensemble.json');
    const content = JSON.stringify(metadata, null, 2);
    const result = await this.electronService.writeFileAtomic(ensemblePath, content);
    if (!result.success) {
      throw new Error(`Failed to save metadata: ${result.error}`);
    }
  }

  /**
   * Validates metadata structure
   */
  private isValidMetadata(metadata: any): metadata is ProjectMetadata {
    return (
      metadata &&
      typeof metadata.projectName === 'string' &&
      typeof metadata.version === 'string' &&
      Array.isArray(metadata.categories) &&
      Array.isArray(metadata.tags) &&
      metadata.settings &&
      typeof metadata.settings.defaultCategory === 'string' &&
      typeof metadata.settings.autoSave === 'boolean' &&
      typeof metadata.settings.fileWatchEnabled === 'boolean'
    );
  }

  getCategories(): Category[] {
    const project = this.currentProjectSubject.value;
    return project?.metadata.categories || [];
  }

  getTags(): Tag[] {
    const project = this.currentProjectSubject.value;
    return project?.metadata.tags || [];
  }

  getBooks(): Book[] {
    const project = this.currentProjectSubject.value;
    return project?.metadata.books || [];
  }

  /**
   * Adds a new category to the current project
   */
  async addCategory(category: Omit<Category, 'id'>): Promise<Category | null> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const newCategory: Category = {
      id: this.generateId(),
      ...category,
    };

    project.metadata.categories.push(newCategory);
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });

    return newCategory;
  }

  /**
   * Adds a new tag to the current project
   */
  async addTag(tag: Omit<Tag, 'id'>): Promise<Tag | null> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const newTag: Tag = {
      id: this.generateId(),
      ...tag,
    };

    project.metadata.tags.push(newTag);
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });

    return newTag;
  }

  /**
   * Updates project metadata
   */
  async updateMetadata(updates: Partial<ProjectMetadata>): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    project.metadata = { ...project.metadata, ...updates };
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Removes a category from the current project
   */
  async removeCategory(categoryId: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    project.metadata.categories = project.metadata.categories.filter((cat) => cat.id !== categoryId);
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Removes a tag from the current project
   */
  async removeTag(tagId: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    project.metadata.tags = project.metadata.tags.filter((tag) => tag.id !== tagId);
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Manages recent projects list
   */
  private addToRecentProjects(projectPath: string): void {
    // Remove if already exists
    this.recentProjects = this.recentProjects.filter((p) => p !== projectPath);

    // Add to beginning
    this.recentProjects.unshift(projectPath);

    // Keep only last 10
    this.recentProjects = this.recentProjects.slice(0, 10);

    this.saveRecentProjects();
  }

  /**
   * Loads recent projects from localStorage
   */
  private loadRecentProjects(): void {
    try {
      const stored = localStorage.getItem('ensemble-recent-projects');
      if (stored) {
        this.recentProjects = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load recent projects:', error);
      this.recentProjects = [];
    }
  }

  /**
   * Saves recent projects to localStorage
   */
  private saveRecentProjects(): void {
    try {
      localStorage.setItem('ensemble-recent-projects', JSON.stringify(this.recentProjects));
    } catch (error) {
      console.warn('Failed to save recent projects:', error);
    }
  }

  /**
   * Removes a project from recent projects list
   */
  removeFromRecentProjects(projectPath: string): void {
    this.recentProjects = this.recentProjects.filter((p) => p !== projectPath);
    this.saveRecentProjects();
  }

  /**
   * Clears all recent projects
   */
  clearRecentProjects(): void {
    this.recentProjects = [];
    this.saveRecentProjects();
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Saves graph view state to project settings
   */
  async saveGraphViewState(state: GraphViewState): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    project.metadata.settings.graphView = state;
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Gets the saved graph view state from project settings
   */
  getGraphViewState(): GraphViewState | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.settings.graphView || null;
  }

  /**
   * Gets relationships data from the current project
   */
  getRelationships(): { nodes: GraphNode[]; edges: Relationship[] } {
    const project = this.currentProjectSubject.value;
    return project?.metadata.relationships || { nodes: [], edges: [] };
  }

  /**
   * Updates relationships data in the current project
   */
  async updateRelationships(relationships: { nodes: GraphNode[]; edges: Relationship[] }): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    project.metadata.relationships = relationships;
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }
}
