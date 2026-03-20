import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Book,
  Category,
  GraphNode,
  GraphViewState,
  Pinboard,
  PinboardPin,
  PinboardConnection,
  PinboardViewState,
  Project,
  ProjectMetadata,
  Relationship,
  Tag,
} from '../interfaces/project.interface';
import { generateId } from '../utils/id.utils';
import { pathJoin } from '../utils/path.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import { COLOR_PALETTE } from '../utils/color-palette.utils';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private currentProjectSubject = new BehaviorSubject<Project | null>(null);
  public currentProject$ = this.currentProjectSubject.asObservable();
  private recentProjects: Array<{ path: string; lastAccessed: string }> = [];

  constructor(
    private electronService: ElectronService,
    private logger: LoggingService
  ) {
    // Load recent projects asynchronously
    this.loadRecentProjects().catch(err => {
      this.logger.error('Failed to load recent projects on init', err);
    });
  }

  getCurrentProject(): Project | null {
    return this.currentProjectSubject.value;
  }

  getRecentProjects(): string[] {
    // Return just the paths for backward compatibility
    return this.recentProjects.map(p => p.path);
  }

  getRecentProjectsWithTimestamps(): Array<{ path: string; lastAccessed: Date }> {
    return this.recentProjects
      .filter(p => p && typeof p.path === 'string' && p.path.trim().length > 0)
      .map(p => ({
        path: p.path,
        lastAccessed: new Date(p.lastAccessed)
      }));
  }

  getMostRecentProject(): string | null {
    return this.recentProjects.length > 0 ? this.recentProjects[0].path : null;
  }

  /**
   * Returns the absolute path to the characters folder for the current project.
   * Uses settings.charactersFolder if set, otherwise defaults to 'characters'.
   */
  getCharactersFolderPath(): string {
    const project = this.currentProjectSubject.value;
    if (!project?.path) {
      throw new Error('No project loaded');
    }
    const folder = project.metadata?.settings?.charactersFolder?.trim() || 'characters';
    const normalized = folder.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'characters';
    return pathJoin(project.path, normalized);
  }

  /**
   * Returns the absolute path to the casts folder for the current project.
   * Uses settings.castsFolder relative to project root (default: 'characters/casts').
   * Legacy: stored value 'casts' (no path separators) is treated as 'characters/casts'.
   */
  getCastsFolderPath(): string {
    const project = this.currentProjectSubject.value;
    if (!project?.path) {
      throw new Error('No project loaded');
    }
    const raw = project.metadata?.settings?.castsFolder?.trim() || 'characters/casts';
    // Legacy: "casts" alone meant "under characters folder"
    const relative = raw.includes('/') ? raw : `characters/${raw}`;
    const normalized = relative.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'characters/casts';
    return pathJoin(project.path, normalized);
  }

  /**
   * Returns the absolute path to the names file for the current project.
   * Uses settings.namesFile if set (relative to project root), otherwise defaults to 'characters/names.md'.
   */
  getNamesFilePath(): string {
    const project = this.currentProjectSubject.value;
    if (!project?.path) {
      throw new Error('No project loaded');
    }
    const relative = project.metadata?.settings?.namesFile?.trim() || 'characters/names.md';
    const normalized = relative.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'characters/names.md';
    return pathJoin(project.path, normalized);
  }

  /**
   * Returns the relative characters folder name from project settings (e.g. 'characters' or 'personas').
   */
  getCharactersFolderName(): string {
    const project = this.currentProjectSubject.value;
    const folder = project?.metadata?.settings?.charactersFolder?.trim();
    if (!folder) return 'characters';
    const normalized = folder.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    return normalized || 'characters';
  }

  /**
   * Opens Electron folder selection dialog
   */
  async selectProject(): Promise<string | null> {
    try {
      return await this.electronService.selectFolder();
    } catch (error) {
      this.logger.error('Failed to open folder selection dialog', error);
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
      const ensemblePath = pathJoin(projectPath, 'ensemble.json');
      const metadataPath = pathJoin(projectPath, 'metadata.json');
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
          const relationshipsPath = pathJoin(projectPath, 'relationships.json');
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
            const relationshipsPath = pathJoin(projectPath, 'relationships.json');
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
      const charactersFolder = metadata.settings?.charactersFolder?.trim() || 'characters';
      await this.ensureProjectStructure(projectPath, charactersFolder);

      // Migrate legacy pinboard to new structure if needed
      await this.migrateLegacyPinboard(metadata);
      
      // Save metadata if migration occurred (migration modifies metadata in place)
      if (metadata.pinboards && metadata.pinboards.length > 0) {
        await this.saveMetadata(projectPath, metadata);
      }

      const project: Project = {
        path: projectPath,
        metadata,
      };

      this.currentProjectSubject.next(project);
      this.addToRecentProjects(projectPath);

      return project;
    } catch (error) {
      this.logger.error('Failed to load project', error);
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
        const metadataPath = pathJoin(projectPath, 'metadata.json');
        const hasMetadata = await this.electronService.fileExists(metadataPath);
        if (hasMetadata) {
          throw new Error(`Directory already contains a project: ${projectPath}`);
        }
      }

      // Create directory structure (use default 'characters' for new projects)
      await this.ensureProjectStructure(projectPath, 'characters');

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
      this.logger.error('Failed to create project', error);
      throw new Error(`Failed to create project: ${error}`);
    }
  }

  /**
   * Duplicates an existing project to a new location with a new name
   */
  async duplicateProject(sourceProjectPath: string, destinationPath: string, newProjectName: string): Promise<Project | null> {
    try {
      // Validate source project exists and is a valid project
      const sourceExists = await this.electronService.fileExists(sourceProjectPath);
      if (!sourceExists) {
        throw new Error(`Source project does not exist: ${sourceProjectPath}`);
      }

      const sourceIsDir = await this.electronService.isDirectory(sourceProjectPath);
      if (!sourceIsDir) {
        throw new Error(`Source path is not a directory: ${sourceProjectPath}`);
      }

      // Check if source has ensemble.json or metadata.json (valid project)
      const sourceEnsemblePath = pathJoin(sourceProjectPath, 'ensemble.json');
      const sourceMetadataPath = pathJoin(sourceProjectPath, 'metadata.json');
      const hasEnsemble = await this.electronService.fileExists(sourceEnsemblePath);
      const hasMetadata = await this.electronService.fileExists(sourceMetadataPath);
      
      if (!hasEnsemble && !hasMetadata) {
        throw new Error(`Source directory does not appear to be a valid project: ${sourceProjectPath}`);
      }

      // Validate destination path doesn't already contain a project
      const sanitizedName = await this.electronService.sanitizeFilename(newProjectName);
      const destProjectPath = await this.electronService.pathJoin(destinationPath, sanitizedName);
      
      const destExists = await this.electronService.fileExists(destProjectPath);
      if (destExists) {
        const destEnsemblePath = pathJoin(destProjectPath, 'ensemble.json');
        const destMetadataPath = pathJoin(destProjectPath, 'metadata.json');
        const destHasEnsemble = await this.electronService.fileExists(destEnsemblePath);
        const destHasMetadata = await this.electronService.fileExists(destMetadataPath);
        
        if (destHasEnsemble || destHasMetadata) {
          throw new Error(`Destination already contains a project: ${destProjectPath}`);
        }
      }

      // Recursively copy entire project directory to destination
      const copyResult = await this.electronService.copyDirectoryRecursive(sourceProjectPath, destProjectPath);
      if (!copyResult.success) {
        throw new Error(`Failed to copy project: ${copyResult.error}`);
      }

      // Load the duplicated project's ensemble.json (or metadata.json for legacy)
      const destEnsemblePath = pathJoin(destProjectPath, 'ensemble.json');
      const destMetadataPath = pathJoin(destProjectPath, 'metadata.json');
      const destHasEnsemble = await this.electronService.fileExists(destEnsemblePath);
      const destHasMetadata = await this.electronService.fileExists(destMetadataPath);

      let metadata: ProjectMetadata;
      if (destHasEnsemble) {
        const result = await this.electronService.readFile(destEnsemblePath);
        if (!result.success) {
          throw new Error(`Failed to read ensemble.json: ${result.error}`);
        }
        metadata = JSON.parse(result.content!);
      } else if (destHasMetadata) {
        const result = await this.electronService.readFile(destMetadataPath);
        if (!result.success) {
          throw new Error(`Failed to read metadata.json: ${result.error}`);
        }
        metadata = JSON.parse(result.content!);
      } else {
        throw new Error('Duplicated project does not contain metadata file');
      }

      // Update the projectName in metadata to the new name
      metadata.projectName = newProjectName;

      // Save the updated metadata
      await this.saveMetadata(destProjectPath, metadata);

      // Load the duplicated project
      const project = await this.loadProject(destProjectPath);
      
      if (!project) {
        throw new Error('Failed to load duplicated project');
      }

      return project;
    } catch (error) {
      this.logger.error('Failed to duplicate project', error);
      throw new Error(`Failed to duplicate project: ${error}`);
    }
  }

  /**
   * Ensures the project directory structure exists
   */
  private async ensureProjectStructure(projectPath: string, charactersFolder = 'characters'): Promise<void> {
    try {
      // Create main project directory
      assertIpcSuccess(
        await this.electronService.createDirectory(projectPath),
        'Create main directory'
      );

      // Create characters subdirectory (configurable path)
      const normalized = charactersFolder.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'characters';
      const charactersPath = pathJoin(projectPath, normalized);
      assertIpcSuccess(
        await this.electronService.createDirectory(charactersPath),
        'Create characters directory'
      );

      // Note: Thumbnails are now stored in individual character folders
      // No need to create a global thumbnails directory
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
        { id: 'main-character', name: 'Main Character', color: COLOR_PALETTE[0] },
        { id: 'supporting', name: 'Supporting Character', color: COLOR_PALETTE[1] },
        { id: 'antagonist', name: 'Antagonist', color: COLOR_PALETTE[2] },
        { id: 'minor', name: 'Minor Character', color: COLOR_PALETTE[3] },
      ],
      tags: [
        { id: 'magic-user', name: 'Magic User', color: COLOR_PALETTE[6] },
        { id: 'noble', name: 'Noble', color: COLOR_PALETTE[7] },
        { id: 'warrior', name: 'Warrior', color: COLOR_PALETTE[2] },
        { id: 'scholar', name: 'Scholar', color: COLOR_PALETTE[5] },
      ],
      casts: [],
      books: [],
      settings: {
        defaultCategory: 'main-character',
        autoSave: true,
        fileWatchEnabled: true,
        charactersFolder: 'characters',
        castsFolder: 'characters/casts',
      },
      pinboards: [
        {
          id: generateId(),
          name: 'Default',
          nodes: [],
          edges: [],
          createdAt: new Date().toISOString(),
        },
      ],
      currentPinboardId: undefined, // Will be set to first pinboard
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
    const ensemblePath = pathJoin(projectPath, 'ensemble.json');
    const content = JSON.stringify(metadata, null, 2);
    assertIpcSuccess(
      await this.electronService.writeFileAtomic(ensemblePath, content),
      'Save metadata'
    );
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
      id: generateId(),
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
      id: generateId(),
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
    this.recentProjects = this.recentProjects.filter((p) => p.path !== projectPath);

    // Add to beginning with current timestamp
    this.recentProjects.unshift({
      path: projectPath,
      lastAccessed: new Date().toISOString()
    });

    // Keep only last 10
    this.recentProjects = this.recentProjects.slice(0, 10);

    // Save asynchronously (fire and forget)
    this.saveRecentProjects().catch(err => {
      this.logger.error('Failed to save recent projects', err);
    });
  }

  /**
   * Loads recent projects from persistent storage (file-based in Electron)
   */
  private async loadRecentProjects(): Promise<void> {
    try {
      const projects = await this.electronService.getRecentProjects();
      // The electron service already handles backward compatibility
      // and returns Array<{ path: string; lastAccessed: string }>
      if (Array.isArray(projects)) {
        // Filter out invalid entries where path is not a string
        this.recentProjects = projects.filter(
          p => p && typeof p.path === 'string' && p.path.trim().length > 0
        );
      } else {
        this.recentProjects = [];
      }
    } catch (error) {
      console.warn('Failed to load recent projects:', error);
      this.recentProjects = [];
    }
  }

  /**
   * Saves recent projects to persistent storage (file-based in Electron)
   */
  private async saveRecentProjects(): Promise<void> {
    try {
      const result = await this.electronService.saveRecentProjects(this.recentProjects);
      if (!result.success) {
        this.logger.error('Failed to save recent projects', result.error);
      }
    } catch (error) {
      console.warn('Failed to save recent projects:', error);
    }
  }

  /**
   * Removes a project from recent projects list
   */
  removeFromRecentProjects(projectPath: string): void {
    this.recentProjects = this.recentProjects.filter((p) => p.path !== projectPath);
    this.saveRecentProjects().catch(err => {
      this.logger.error('Failed to save recent projects', err);
    });
  }

  /**
   * Clears all recent projects
   */
  clearRecentProjects(): void {
    this.recentProjects = [];
    this.saveRecentProjects().catch(err => {
      this.logger.error('Failed to save recent projects', err);
    });
  }


  /**
   * Saves pinboard view state to the current pinboard's viewState
   */
  async savePinboardViewState(state: PinboardViewState, pinboardId?: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const targetPinboard = pinboardId 
      ? project.metadata.pinboards?.find(p => p.id === pinboardId)
      : this.getCurrentPinboard();
    
    if (targetPinboard) {
      // Save to target pinboard's viewState
      const pinboards = project.metadata.pinboards || [];
      const pinboardIndex = pinboards.findIndex(p => p.id === targetPinboard.id);
      if (pinboardIndex !== -1) {
        pinboards[pinboardIndex] = {
          ...pinboards[pinboardIndex],
          viewState: state,
          updatedAt: new Date().toISOString(),
        };
        project.metadata.pinboards = pinboards;
      }
    } else {
      // Fallback to project settings for backward compatibility
      project.metadata.settings.pinboardView = state;
      project.metadata.settings.graphView = state;
    }

    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Gets the saved pinboard view state from the current pinboard's viewState
   */
  getPinboardViewState(): PinboardViewState | null {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return null;
    }

    const currentPinboard = this.getCurrentPinboard();
    if (currentPinboard?.viewState) {
      return currentPinboard.viewState;
    }

    // Fallback to project settings for backward compatibility
    return project.metadata.settings.pinboardView || project.metadata.settings.graphView || null;
  }

  /**
   * @deprecated Use savePinboardViewState() instead
   * Legacy method for backward compatibility
   */
  async saveGraphViewState(state: GraphViewState): Promise<void> {
    return this.savePinboardViewState(state);
  }

  /**
   * @deprecated Use getPinboardViewState() instead
   * Legacy method for backward compatibility
   */
  getGraphViewState(): GraphViewState | null {
    return this.getPinboardViewState();
  }

  /**
   * Saves the last visited route to project settings
   */
  async saveLastRoute(route: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return; // Don't throw error if no project is loaded
    }

    // Only save if the route has actually changed
    if (project.metadata.settings.lastRoute === route) {
      return;
    }

    project.metadata.settings.lastRoute = route;
    await this.saveMetadata(project.path, project.metadata);
    // Don't emit a new project update to avoid triggering unnecessary re-renders
  }

  /**
   * Gets the last visited route from project settings
   */
  getLastRoute(): string | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.settings.lastRoute || null;
  }

  /**
   * Saves the filter expanded state to project settings
   */
  async saveFilterExpandedState(expanded: boolean): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return; // Don't throw error if no project is loaded
    }

    // Only save if the state has actually changed
    if (project.metadata.settings.filterExpanded === expanded) {
      return;
    }

    project.metadata.settings.filterExpanded = expanded;
    await this.saveMetadata(project.path, project.metadata);
    // Don't emit a new project update to avoid triggering unnecessary re-renders
  }

  /**
   * Gets the filter expanded state from project settings
   */
  getFilterExpandedState(): boolean {
    const project = this.currentProjectSubject.value;
    return project?.metadata.settings.filterExpanded ?? false;
  }

  async saveplotBoardZoom(zoom: number): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) return;
    if (project.metadata.settings.plotBoardZoom === zoom) return;
    project.metadata.settings.plotBoardZoom = zoom;
    await this.saveMetadata(project.path, project.metadata);
  }

  getPlotBoardZoom(): number | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.settings.plotBoardZoom ?? null;
  }

  async saveLastPlotboardPath(relativePath: string | null): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) return;
    const next = relativePath ?? undefined;
    if (project.metadata.settings.lastPlotboardPath === next) return;
    project.metadata.settings.lastPlotboardPath = next;
    await this.saveMetadata(project.path, project.metadata);
  }

  getLastPlotboardPath(): string | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.settings.lastPlotboardPath ?? null;
  }

  /**
   * Migrates legacy single pinboard to new multiple pinboards structure
   */
  private async migrateLegacyPinboard(metadata: ProjectMetadata): Promise<void> {
    // If pinboards array already exists, no migration needed
    if (metadata.pinboards && metadata.pinboards.length > 0) {
      // Ensure currentPinboardId is set
      if (!metadata.currentPinboardId && metadata.pinboards.length > 0) {
        metadata.currentPinboardId = metadata.pinboards[0].id;
      }
      return;
    }

    // Check for legacy relationships
    if (metadata.relationships) {
      const legacyData = metadata.relationships;
      
      // Create "Default" pinboard from legacy data
      const defaultPinboard: Pinboard = {
        id: generateId(),
        name: 'Default',
        nodes: legacyData.nodes || [],
        edges: legacyData.edges || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Migrate view state if it exists
      if (metadata.settings?.pinboardView) {
        defaultPinboard.viewState = metadata.settings.pinboardView;
      } else if (metadata.settings?.graphView) {
        defaultPinboard.viewState = metadata.settings.graphView;
      }

      metadata.pinboards = [defaultPinboard];
      metadata.currentPinboardId = defaultPinboard.id;
      
      // Keep relationships temporarily for rollback safety
      // Will be removed after stable period
    } else {
      // No legacy data, create empty default pinboard
      metadata.pinboards = [
        {
          id: generateId(),
          name: 'Default',
          nodes: [],
          edges: [],
          createdAt: new Date().toISOString(),
        },
      ];
      metadata.currentPinboardId = metadata.pinboards[0].id;
    }
  }

  /**
   * Gets all pinboards from the current project
   */
  getPinboards(): Pinboard[] {
    const project = this.currentProjectSubject.value;
    return project?.metadata.pinboards || [];
  }

  /**
   * Gets the current active pinboard
   */
  getCurrentPinboard(): Pinboard | null {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return null;
    }

    const pinboards = project.metadata.pinboards || [];
    const currentId = project.metadata.currentPinboardId;

    if (currentId) {
      const pinboard = pinboards.find(p => p.id === currentId);
      if (pinboard) {
        return pinboard;
      }
    }

    // Fallback to first pinboard if current not found
    if (pinboards.length > 0) {
      return pinboards[0];
    }

    return null;
  }

  /**
   * Sets the current active pinboard
   */
  async setCurrentPinboard(id: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const pinboards = project.metadata.pinboards || [];
    const pinboard = pinboards.find(p => p.id === id);
    if (!pinboard) {
      throw new Error(`Pinboard with id ${id} not found`);
    }

    project.metadata.currentPinboardId = id;
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Creates a new pinboard
   */
  async createPinboard(name: string, duplicateFromId?: string): Promise<Pinboard> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const pinboards = project.metadata.pinboards || [];
    
    // Check for duplicate name
    if (pinboards.some(p => p.name === name)) {
      throw new Error(`A pinboard named "${name}" already exists`);
    }

    const newPinboard: Pinboard = {
      id: generateId(),
      name,
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
    };

    // Optionally duplicate from another pinboard
    if (duplicateFromId) {
      const sourcePinboard = pinboards.find(p => p.id === duplicateFromId);
      if (sourcePinboard) {
        newPinboard.nodes = JSON.parse(JSON.stringify(sourcePinboard.nodes));
        newPinboard.edges = JSON.parse(JSON.stringify(sourcePinboard.edges));
        if (sourcePinboard.viewState) {
          newPinboard.viewState = JSON.parse(JSON.stringify(sourcePinboard.viewState));
        }
      }
    }

    pinboards.push(newPinboard);
    project.metadata.pinboards = pinboards;
    
    // Set as current if it's the first pinboard
    if (pinboards.length === 1) {
      project.metadata.currentPinboardId = newPinboard.id;
    }

    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });

    return newPinboard;
  }

  /**
   * Updates pinboard data (nodes and edges) for a specific pinboard by ID
   */
  async updatePinboardById(id: string, data: { nodes: PinboardPin[]; edges: PinboardConnection[] }): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const pinboards = project.metadata.pinboards || [];
    const pinboardIndex = pinboards.findIndex(p => p.id === id);
    
    if (pinboardIndex === -1) {
      throw new Error(`Pinboard with id ${id} not found`);
    }

    pinboards[pinboardIndex] = {
      ...pinboards[pinboardIndex],
      nodes: data.nodes,
      edges: data.edges,
      updatedAt: new Date().toISOString(),
    };

    project.metadata.pinboards = pinboards;
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Updates pinboard name
   */
  async updatePinboardName(id: string, name: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const pinboards = project.metadata.pinboards || [];
    const pinboardIndex = pinboards.findIndex(p => p.id === id);
    
    if (pinboardIndex === -1) {
      throw new Error(`Pinboard with id ${id} not found`);
    }

    // Check for duplicate name
    if (pinboards.some((p, idx) => p.name === name && idx !== pinboardIndex)) {
      throw new Error(`A pinboard named "${name}" already exists`);
    }

    pinboards[pinboardIndex] = {
      ...pinboards[pinboardIndex],
      name,
      updatedAt: new Date().toISOString(),
    };

    project.metadata.pinboards = pinboards;
    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Deletes a pinboard
   */
  async deletePinboard(id: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const pinboards = project.metadata.pinboards || [];

    const pinboardIndex = pinboards.findIndex(p => p.id === id);
    if (pinboardIndex === -1) {
      throw new Error(`Pinboard with id ${id} not found`);
    }

    // Remove the pinboard
    pinboards.splice(pinboardIndex, 1);
    project.metadata.pinboards = pinboards;

    // If deleted pinboard was current, switch to first available
    if (project.metadata.currentPinboardId === id) {
      project.metadata.currentPinboardId = pinboards.length > 0 ? pinboards[0].id : undefined;
    }

    await this.saveMetadata(project.path, project.metadata);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Gets pinboard data from the current active pinboard
   */
  getPinboard(): { nodes: PinboardPin[]; edges: PinboardConnection[] } {
    const currentPinboard = this.getCurrentPinboard();
    if (currentPinboard) {
      return {
        nodes: currentPinboard.nodes,
        edges: currentPinboard.edges,
      };
    }
    
    // Fallback to legacy relationships for backward compatibility
    const project = this.currentProjectSubject.value;
    return project?.metadata.relationships || { nodes: [], edges: [] };
  }

  /**
   * Updates pinboard data in the current active pinboard
   */
  async updatePinboard(pinboard: { nodes: PinboardPin[]; edges: PinboardConnection[] }): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      throw new Error('No project loaded');
    }

    const currentPinboard = this.getCurrentPinboard();
    if (currentPinboard) {
      await this.updatePinboardById(currentPinboard.id, pinboard);
    } else {
      // Fallback to legacy relationships for backward compatibility
      project.metadata.relationships = pinboard;
      await this.saveMetadata(project.path, project.metadata);
      this.currentProjectSubject.next({ ...project });
    }
  }

  /**
   * @deprecated Use getPinboard() instead
   * Legacy method for backward compatibility
   */
  getRelationships(): { nodes: GraphNode[]; edges: Relationship[] } {
    return this.getPinboard();
  }

  /**
   * @deprecated Use updatePinboard() instead
   * Legacy method for backward compatibility
   */
  async updateRelationships(relationships: { nodes: GraphNode[]; edges: Relationship[] }): Promise<void> {
    return this.updatePinboard(relationships);
  }
}
