import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Book,
  Category,
  CharacterStyle,
  Pinboard,
  PinboardPin,
  PinboardConnection,
  PinboardViewState,
  Project,
  ProjectMetadata,
  ProjectSettings,
  Tag,
} from '../interfaces/project.interface';
import { LegacyProjectMetadataFields } from '../interfaces/legacy.interface';
import { generateId } from '../utils/id.utils';
import { pathBasename, pathJoin } from '../utils/path.utils';
import { sanitizeFilename } from '../utils/slug.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import {
  ENSEMBLE_JSON_FILE,
  LEGACY_METADATA_JSON_FILE,
  DEFAULT_CHARACTERS_FOLDER,
  DEFAULT_IMAGES_FOLDER,
  DEFAULT_CASTS_FOLDER,
  DEFAULT_NAMES_FILE,
  DEFAULT_CATEGORIES,
  DEFAULT_TAGS,
  DEFAULT_CHARACTER_STYLES,
  DEFAULT_CHARACTER_STYLE_ID,
  normalizeRelativeFolder,
} from '../constants/project.constants';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';
import { requireProject } from '../utils/project.utils';
import { PinboardStoreService } from './pinboard-store.service';
import { RecentProjectsService } from './recent-projects.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private currentProjectSubject = new BehaviorSubject<Project | null>(null);
  public currentProject$ = this.currentProjectSubject.asObservable();
  constructor(
    private electronService: ElectronService,
    private logger: LoggingService,
    private pinboardStore: PinboardStoreService,
    private recentProjects: RecentProjectsService
  ) {}

  getCurrentProject(): Project | null {
    return this.currentProjectSubject.value;
  }

  getRecentProjects(): string[] {
    // Return just the paths for backward compatibility
    return this.recentProjects.getAll().map(p => p.path);
  }

  getRecentProjectsWithTimestamps(): Array<{ path: string; lastAccessed: Date }> {
    return this.recentProjects.getAll()
      .filter(p => p && typeof p.path === 'string' && p.path.trim().length > 0)
      .map(p => ({
        path: p.path,
        lastAccessed: new Date(p.lastAccessed)
      }));
  }

  getMostRecentProject(): string | null {
    return this.recentProjects.getAll()[0]?.path || null;
  }

  /**
   * Returns the absolute path to the characters folder for the current project.
   * Uses settings.charactersFolder if set, otherwise defaults to 'characters'.
   */
  getCharactersFolderPath(): string {
    const project = requireProject(this.currentProjectSubject.value);
    const folder = project.metadata?.settings?.charactersFolder?.trim() || DEFAULT_CHARACTERS_FOLDER;
    const normalized = normalizeRelativeFolder(folder, DEFAULT_CHARACTERS_FOLDER);
    return pathJoin(project.path, normalized);
  }

  getImagesFolderPath(): string {
    const project = requireProject(this.currentProjectSubject.value);
    const folder = project.metadata?.settings?.imagesFolder?.trim() || DEFAULT_IMAGES_FOLDER;
    const normalized = normalizeRelativeFolder(folder, DEFAULT_IMAGES_FOLDER);
    return pathJoin(project.path, normalized);
  }

  /**
   * Returns the absolute path to the casts folder for the current project.
   * Uses settings.castsFolder relative to project root (default: 'characters/casts').
   * Legacy: stored value 'casts' (no path separators) is treated as 'characters/casts'.
   */
  getCastsFolderPath(): string {
    const project = requireProject(this.currentProjectSubject.value);
    const raw = project.metadata?.settings?.castsFolder?.trim() || DEFAULT_CASTS_FOLDER;
    // Legacy: "casts" alone meant "under characters folder"
    const relative = raw.includes('/') ? raw : `${DEFAULT_CHARACTERS_FOLDER}/${raw}`;
    const normalized = normalizeRelativeFolder(relative, DEFAULT_CASTS_FOLDER);
    return pathJoin(project.path, normalized);
  }

  /**
   * Returns the absolute path to the names file for the current project.
   * Uses settings.namesFile if set (relative to project root), otherwise defaults to 'characters/names.md'.
   */
  getNamesFilePath(): string {
    const project = requireProject(this.currentProjectSubject.value);
    const relative = project.metadata?.settings?.namesFile?.trim() || DEFAULT_NAMES_FILE;
    const normalized = normalizeRelativeFolder(relative, DEFAULT_NAMES_FILE);
    return pathJoin(project.path, normalized);
  }

  /**
   * Returns the relative characters folder name from project settings (e.g. 'characters' or 'personas').
   */
  getCharactersFolderName(): string {
    const project = this.currentProjectSubject.value;
    const folder = project?.metadata?.settings?.charactersFolder?.trim();
    if (!folder) return DEFAULT_CHARACTERS_FOLDER;
    return normalizeRelativeFolder(folder, DEFAULT_CHARACTERS_FOLDER);
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
      await this.electronService.setWorkFolder(projectPath);

      // Check if directory exists
      const isDir = await this.electronService.isDirectory(projectPath);
      if (!isDir) {
        throw new Error(`Project path is not a directory: ${projectPath}`);
      }

      // Load ensemble.json (or fallback to metadata.json for migration)
      const ensemblePath = pathJoin(projectPath, ENSEMBLE_JSON_FILE);
      const metadataPath = pathJoin(projectPath, LEGACY_METADATA_JSON_FILE);
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

          // Validate metadata structure
          if (!this.isValidMetadata(metadata)) {
            throw new Error('Invalid metadata structure in project');
          }

          // Save as ensemble.json and delete old metadata file
          await this.saveMetadata(projectPath, metadata);
          await this.electronService.deleteFile(metadataPath);
        } catch (parseError) {
          throw new Error(`Invalid JSON in metadata file: ${parseError}`);
        }
      } else {
        // Create default metadata if it doesn't exist
        const projectName = pathBasename(projectPath);
        metadata = this.createDefaultMetadata(projectName);
        await this.saveMetadata(projectPath, metadata);
      }

      // Ensure required directories exist
      const charactersFolder = metadata.settings?.charactersFolder?.trim() || DEFAULT_CHARACTERS_FOLDER;
      await this.ensureProjectStructure(projectPath, charactersFolder);

      this.migrateLastSessionFromLegacy(metadata);

      // Ensure a default pinboard exists and lastSession tracks it
      this.ensureDefaultPinboard(metadata);

      const stylesSeeded = this.ensureCharacterStyles(metadata);
      const legacySettingsStripped = this.stripLegacySettingsInPlace(metadata);

      // Save metadata if initialization modified it in place
      if (
        (metadata.pinboards && metadata.pinboards.length > 0) ||
        stylesSeeded ||
        legacySettingsStripped
      ) {
        await this.saveMetadata(projectPath, metadata);
      }

      const project: Project = {
        path: projectPath,
        metadata,
      };

      this.currentProjectSubject.next(project);
      this.recentProjects.add(projectPath);

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
      await this.electronService.setWorkFolder(projectPath);

      // Check if directory already exists
      const exists = await this.electronService.fileExists(projectPath);
      if (exists) {
        const isDir = await this.electronService.isDirectory(projectPath);
        if (!isDir) {
          throw new Error(`Path exists but is not a directory: ${projectPath}`);
        }

        // Check if it's already a project (has metadata.json)
        const metadataPath = pathJoin(projectPath, LEGACY_METADATA_JSON_FILE);
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
      this.recentProjects.add(projectPath);

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
      await this.electronService.setWorkFolder(sourceProjectPath);

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
      const sourceEnsemblePath = pathJoin(sourceProjectPath, ENSEMBLE_JSON_FILE);
      const sourceMetadataPath = pathJoin(sourceProjectPath, LEGACY_METADATA_JSON_FILE);
      const hasEnsemble = await this.electronService.fileExists(sourceEnsemblePath);
      const hasMetadata = await this.electronService.fileExists(sourceMetadataPath);
      
      if (!hasEnsemble && !hasMetadata) {
        throw new Error(`Source directory does not appear to be a valid project: ${sourceProjectPath}`);
      }

      // Validate destination path doesn't already contain a project
      const sanitizedName = sanitizeFilename(newProjectName);
      const destProjectPath = pathJoin(destinationPath, sanitizedName);

      await this.electronService.setWorkFolder(destProjectPath);

      const destExists = await this.electronService.fileExists(destProjectPath);
      if (destExists) {
        const destEnsemblePath = pathJoin(destProjectPath, ENSEMBLE_JSON_FILE);
        const destMetadataPath = pathJoin(destProjectPath, LEGACY_METADATA_JSON_FILE);
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
      const destEnsemblePath = pathJoin(destProjectPath, ENSEMBLE_JSON_FILE);
      const destMetadataPath = pathJoin(destProjectPath, LEGACY_METADATA_JSON_FILE);
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
      const normalized = normalizeRelativeFolder(charactersFolder, DEFAULT_CHARACTERS_FOLDER);
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
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
      tags: DEFAULT_TAGS.map(t => ({ ...t })),
      casts: [],
      books: [],
      series: [],
      sagas: [],
      settings: {
        defaultCategory: DEFAULT_CATEGORIES[0].id,
        charactersFolder: DEFAULT_CHARACTERS_FOLDER,
        castsFolder: DEFAULT_CASTS_FOLDER,
        imagesFolder: DEFAULT_IMAGES_FOLDER,
        characterStyles: DEFAULT_CHARACTER_STYLES.map((s) => ({ ...s })),
        defaultCharacterStyle: DEFAULT_CHARACTER_STYLE_ID,
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
    };
  }

  /**
   * Saves metadata to the project's ensemble.json file
   */
  private async saveMetadata(projectPath: string, metadata: ProjectMetadata): Promise<void> {
    const ensemblePath = pathJoin(projectPath, ENSEMBLE_JSON_FILE);
    const content = JSON.stringify(metadata, null, 2);
    assertIpcSuccess(
      await this.electronService.writeFileAtomic(ensemblePath, content),
      'Save metadata'
    );
  }

  private async mutateMetadata(mutator: (metadata: ProjectMetadata) => void): Promise<Project> {
    const project = requireProject(this.currentProjectSubject.value);
    const metadata = { ...project.metadata };
    mutator(metadata);
    const updatedProject = { ...project, metadata };
    await this.saveMetadata(updatedProject.path, metadata);
    this.currentProjectSubject.next(updatedProject);
    return updatedProject;
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
      typeof metadata.settings.defaultCategory === 'string'
    );
  }

  /** Drops removed settings keys still present in older ensemble.json files. */
  private stripLegacySettingsInPlace(metadata: ProjectMetadata): boolean {
    const settings = metadata.settings as ProjectSettings & {
      autoSave?: unknown;
      fileWatchEnabled?: unknown;
    };
    let changed = false;
    if ('autoSave' in settings) {
      delete settings.autoSave;
      changed = true;
    }
    if ('fileWatchEnabled' in settings) {
      delete settings.fileWatchEnabled;
      changed = true;
    }
    return changed;
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
    const newCategory: Category = {
      id: generateId(),
      ...category,
    };

    await this.mutateMetadata((metadata) => {
      metadata.categories = [...metadata.categories, newCategory];
    });

    return newCategory;
  }

  /**
   * Adds a new tag to the current project
   */
  async addTag(tag: Omit<Tag, 'id'>): Promise<Tag | null> {
    const newTag: Tag = {
      id: generateId(),
      ...tag,
    };

    await this.mutateMetadata((metadata) => {
      metadata.tags = [...metadata.tags, newTag];
    });

    return newTag;
  }

  /**
   * Updates project metadata
   */
  async updateMetadata(updates: Partial<ProjectMetadata>): Promise<void> {
    await this.mutateMetadata((metadata) => Object.assign(metadata, updates));
  }

  /**
   * Removes a category from the current project
   */
  async removeCategory(categoryId: string): Promise<void> {
    await this.mutateMetadata((metadata) => {
      metadata.categories = metadata.categories.filter((cat) => cat.id !== categoryId);
    });
  }

  /**
   * Removes a tag from the current project
   */
  async removeTag(tagId: string): Promise<void> {
    await this.mutateMetadata((metadata) => {
      metadata.tags = metadata.tags.filter((tag) => tag.id !== tagId);
    });
  }

  /**
   * Removes a project from recent projects list
   */
  removeFromRecentProjects(projectPath: string): void {
    this.recentProjects.remove(projectPath);
  }

  /**
   * Clears all recent projects
   */
  clearRecentProjects(): void {
    this.recentProjects.clear();
  }


  /**
   * Saves pinboard view state to the current pinboard's viewState
   */
  async savePinboardViewState(state: PinboardViewState, pinboardId?: string): Promise<void> {
    const project = requireProject(this.currentProjectSubject.value);
    await this.pinboardStore.saveViewState(project, state, pinboardId);
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
    return project.metadata.settings.pinboardView || null;
  }

  /**
   * Saves the last visited route to lastSession
   */
  async saveLastRoute(route: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return; // Don't throw error if no project is loaded
    }

    const ls = this.ensureLastSession(project.metadata);
    if (ls.lastRoute === route) {
      return;
    }

    ls.lastRoute = route;
    await this.saveMetadata(project.path, project.metadata);
    // Don't emit a new project update to avoid triggering unnecessary re-renders
  }

  /**
   * Gets the last visited route from lastSession
   */
  getLastRoute(): string | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.lastSession?.lastRoute || null;
  }

  /**
   * Saves the character list filter panel expanded state to lastSession
   */
  async saveFilterExpandedState(expanded: boolean): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return; // Don't throw error if no project is loaded
    }

    const ls = this.ensureLastSession(project.metadata);
    if (ls.lastCharacterListFilterExpanded === expanded) {
      return;
    }

    ls.lastCharacterListFilterExpanded = expanded;
    await this.saveMetadata(project.path, project.metadata);
    // Don't emit a new project update to avoid triggering unnecessary re-renders
  }

  /**
   * Gets the filter expanded state from lastSession
   */
  getFilterExpandedState(): boolean {
    const project = this.currentProjectSubject.value;
    return project?.metadata.lastSession?.lastCharacterListFilterExpanded ?? false;
  }

  getCharacterStyles(): CharacterStyle[] {
    const project = this.currentProjectSubject.value;
    const styles = project?.metadata.settings?.characterStyles;
    if (styles && styles.length > 0) {
      return styles;
    }
    return DEFAULT_CHARACTER_STYLES.map((s) => ({ ...s }));
  }

  getDefaultCharacterStyle(): string {
    const project = this.currentProjectSubject.value;
    const styles = this.getCharacterStyles();
    const configured = project?.metadata.settings?.defaultCharacterStyle?.trim();
    if (configured && styles.some((s) => s.id === configured)) {
      return configured;
    }
    return styles[0]?.id || DEFAULT_CHARACTER_STYLE_ID;
  }

  async saveLastCharacterListStyle(styleId: string): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) {
      return;
    }
    const ls = this.ensureLastSession(project.metadata);
    if (ls.lastCharacterListStyle === styleId) {
      return;
    }
    ls.lastCharacterListStyle = styleId;
    await this.saveMetadata(project.path, project.metadata);
  }

  getLastCharacterListStyle(): string | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.lastSession?.lastCharacterListStyle ?? null;
  }

  /**
   * Seeds characterStyles / defaultCharacterStyle when missing.
   * @returns true if metadata was modified
   */
  private ensureCharacterStyles(metadata: ProjectMetadata): boolean {
    if (!metadata.settings) {
      return false;
    }
    let changed = false;
    const styles = metadata.settings.characterStyles;
    if (!Array.isArray(styles) || styles.length === 0) {
      metadata.settings.characterStyles = DEFAULT_CHARACTER_STYLES.map((s) => ({ ...s }));
      changed = true;
    }
    const defaultId = metadata.settings.defaultCharacterStyle?.trim();
    const list = metadata.settings.characterStyles!;
    if (!defaultId || !list.some((s) => s.id === defaultId)) {
      metadata.settings.defaultCharacterStyle = list[0]?.id || DEFAULT_CHARACTER_STYLE_ID;
      changed = true;
    }
    return changed;
  }

  async savePlotBoardZoom(zoom: number): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) return;
    const ls = this.ensureLastSession(project.metadata);
    if (ls.lastPlotBoardZoom === zoom) return;
    ls.lastPlotBoardZoom = zoom;
    await this.saveMetadata(project.path, project.metadata);
  }

  getPlotBoardZoom(): number | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.lastSession?.lastPlotBoardZoom ?? null;
  }

  async saveLastPlotboardPath(relativePath: string | null): Promise<void> {
    const project = this.currentProjectSubject.value;
    if (!project) return;
    const next = relativePath ?? undefined;
    const ls = this.ensureLastSession(project.metadata);
    if (ls.lastPlotboardPath === next) return;
    ls.lastPlotboardPath = next;
    await this.saveMetadata(project.path, project.metadata);
  }

  getLastPlotboardPath(): string | null {
    const project = this.currentProjectSubject.value;
    return project?.metadata.lastSession?.lastPlotboardPath ?? null;
  }

  private ensureLastSession(metadata: ProjectMetadata): NonNullable<ProjectMetadata['lastSession']> {
    if (!metadata.lastSession) {
      metadata.lastSession = {};
    }
    return metadata.lastSession;
  }

  /**
   * Moves session memory out of settings (and root currentPinboardId) into lastSession.
   */
  private migrateLastSessionFromLegacy(metadata: ProjectMetadata): void {
    type LegacySettings = ProjectSettings & {
      lastRoute?: string;
      lastPlotboardPath?: string;
      filterExpanded?: boolean;
      plotBoardZoom?: number;
    };
    const s = metadata.settings as LegacySettings;
    const legacyMeta = metadata as ProjectMetadata & LegacyProjectMetadataFields;

    if (legacyMeta.currentPinboardId !== undefined) {
      const ls = this.ensureLastSession(metadata);
      if (ls.lastPinboardId === undefined) {
        ls.lastPinboardId = legacyMeta.currentPinboardId;
      }
      delete legacyMeta.currentPinboardId;
    }

    let ls = metadata.lastSession;
    if (s.lastRoute !== undefined) {
      if (!ls) metadata.lastSession = ls = {};
      if (ls.lastRoute === undefined) ls.lastRoute = s.lastRoute;
      delete s.lastRoute;
    }
    if (s.lastPlotboardPath !== undefined) {
      if (!ls) metadata.lastSession = ls = {};
      if (ls.lastPlotboardPath === undefined) ls.lastPlotboardPath = s.lastPlotboardPath;
      delete s.lastPlotboardPath;
    }
    if (s.filterExpanded !== undefined) {
      if (!ls) metadata.lastSession = ls = {};
      if (ls.lastCharacterListFilterExpanded === undefined) {
        ls.lastCharacterListFilterExpanded = s.filterExpanded;
      }
      delete s.filterExpanded;
    }
    if (s.plotBoardZoom !== undefined) {
      if (!ls) metadata.lastSession = ls = {};
      if (ls.lastPlotBoardZoom === undefined) ls.lastPlotBoardZoom = s.plotBoardZoom;
      delete s.plotBoardZoom;
    }

    if (metadata.lastSession && Object.keys(metadata.lastSession).length === 0) {
      delete metadata.lastSession;
    }
  }

  /**
   * Migrates legacy single pinboard to new multiple pinboards structure
   */
  private ensureDefaultPinboard(metadata: ProjectMetadata): void {
    if (metadata.pinboards && metadata.pinboards.length > 0) {
      const ls = this.ensureLastSession(metadata);
      if (!ls.lastPinboardId) {
        ls.lastPinboardId = metadata.pinboards[0].id;
      }
      return;
    }

    // No pinboards, create empty default pinboard
    metadata.pinboards = [
      {
        id: generateId(),
        name: 'Default',
        nodes: [],
        edges: [],
        createdAt: new Date().toISOString(),
      },
    ];
    this.ensureLastSession(metadata).lastPinboardId = metadata.pinboards[0].id;
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
    return this.pinboardStore.getCurrent(project);
  }

  /**
   * Sets the current active pinboard
   */
  async setCurrentPinboard(id: string): Promise<void> {
    const project = requireProject(this.currentProjectSubject.value);
    await this.pinboardStore.setCurrent(project, id);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Creates a new pinboard
   */
  async createPinboard(name: string, duplicateFromId?: string): Promise<Pinboard> {
    const project = requireProject(this.currentProjectSubject.value);
    const newPinboard = await this.pinboardStore.create(project, name, duplicateFromId);
    this.currentProjectSubject.next({ ...project });

    return newPinboard;
  }

  /**
   * Updates pinboard data (nodes and edges) for a specific pinboard by ID
   */
  async updatePinboardById(id: string, data: { nodes: PinboardPin[]; edges: PinboardConnection[] }): Promise<void> {
    const project = requireProject(this.currentProjectSubject.value);
    await this.pinboardStore.updateData(project, id, data);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Updates pinboard name
   */
  async updatePinboardName(id: string, name: string): Promise<void> {
    const project = requireProject(this.currentProjectSubject.value);
    await this.pinboardStore.updateName(project, id, name);
    this.currentProjectSubject.next({ ...project });
  }

  /**
   * Deletes a pinboard
   */
  async deletePinboard(id: string): Promise<void> {
    const project = requireProject(this.currentProjectSubject.value);
    await this.pinboardStore.delete(project, id);
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
    return { nodes: [], edges: [] };
  }

  /**
   * Updates pinboard data in the current active pinboard
   */
  async updatePinboard(pinboard: { nodes: PinboardPin[]; edges: PinboardConnection[] }): Promise<void> {
    const project = requireProject(this.currentProjectSubject.value);
    const currentPinboard = this.pinboardStore.getCurrent(project);
    if (currentPinboard) {
      await this.updatePinboardById(currentPinboard.id, pinboard);
    } else {
      throw new Error('No active pinboard to update');
    }
  }
}
