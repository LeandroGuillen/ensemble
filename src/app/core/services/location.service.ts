import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { Location, LocationFormData, LocationFrontmatter } from '../interfaces/location.interface';
import { parseMarkdown, generateMarkdown } from '../utils/markdown.utils';
import { asciiSlugify } from '../utils/slug.utils';
import { generateId } from '../utils/id.utils';
import { pathJoin, pathDirname } from '../utils/path.utils';
import { parseThumbnailReference, resolveThumbnailPath } from '../utils/thumbnail.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import { requireProject } from '../utils/project.utils';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

function normalizeLocationRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

@Injectable({
  providedIn: 'root',
})
export class LocationService {
  private locationsSubject = new BehaviorSubject<Location[]>([]);
  public locations$ = this.locationsSubject.asObservable();
  private hasLoadedForCurrentProject = false;
  private currentProjectPath: string | null = null;

  private thumbnailDataUrls: Map<string, string> = new Map();

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private fileWatcherService: FileWatcherService,
    private logger: LoggingService
  ) {
    this.fileWatcherService.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => {
      this.handleFileChange(event);
    });
  }

  getLocations(): Observable<Location[]> {
    return this.locations$;
  }

  getLocationsSnapshot(): Location[] {
    return this.locationsSubject.value;
  }

  getLocationById(id: string): Location | undefined {
    return this.locationsSubject.value.find((loc) => loc.id === id);
  }

  async forceReloadLocations(): Promise<void> {
    this.hasLoadedForCurrentProject = false;
    const projectPath = this.currentProjectPath || this.projectService.getCurrentProject()?.path;
    if (projectPath) {
      this.locationsSubject.next([]);
      await this.loadLocations(projectPath);
    }
  }

  async loadLocations(projectPath: string): Promise<void> {
    if (this.currentProjectPath === projectPath && this.hasLoadedForCurrentProject) {
      return;
    }

    if (this.currentProjectPath !== projectPath) {
      this.currentProjectPath = projectPath;
      this.hasLoadedForCurrentProject = false;
      this.locationsSubject.next([]);
      this.thumbnailDataUrls.clear();
    }

    try {
      const locationsPath = this.projectService.getLocationsFolderPath();

      const dirExists = await this.electronService.fileExists(locationsPath);
      if (!dirExists) {
        assertIpcSuccess(
          await this.electronService.createDirectory(locationsPath),
          'Create locations directory'
        );
        this.hasLoadedForCurrentProject = true;
        return;
      }

      const scanResult = await this.electronService.readDirectoryRecursive(locationsPath, '_*.md');
      if (!scanResult.success || !scanResult.files) {
        this.hasLoadedForCurrentProject = true;
        return;
      }

      const locations: Location[] = [];
      const needsIdPersist: Location[] = [];

      for (const { relativePath, absolutePath } of scanResult.files) {
        try {
          const loaded = await this.loadLocationFromFile(absolutePath, relativePath);
          if (loaded) {
            locations.push(loaded.location);
            if (loaded.assignedId) {
              needsIdPersist.push(loaded.location);
            }
          }
        } catch (error) {
          this.logger.error(`Failed to load location from ${relativePath}:`, error);
        }
      }

      this.assignUniqueLocationIds(locations, needsIdPersist);

      for (const location of needsIdPersist) {
        try {
          await this.saveLocationToFile(location);
        } catch (error) {
          this.logger.error(`Failed to persist stable id for ${location.relativePath}`, error);
        }
      }

      locations.sort((a, b) => a.name.localeCompare(b.name));
      this.locationsSubject.next(locations);
      this.hasLoadedForCurrentProject = true;
    } catch (error) {
      this.logger.error('Failed to load locations', error);
      throw new Error(`Failed to load locations: ${error}`);
    }
  }

  async createLocation(data: LocationFormData): Promise<Location> {
    try {
      const books = data.books || [];
      await this.validateBookReferences(books);

      const slug = asciiSlugify(data.name) || 'location';
      const filename = `_${slug}.md`;
      const locationsPath = this.projectService.getLocationsFolderPath();
      const filePath = pathJoin(locationsPath, filename);
      const relativePath = filename;

      const now = new Date();
      const location: Location = {
        id: generateId(),
        name: data.name,
        books,
        thumbnail: data.thumbnail?.trim() || undefined,
        content: data.content || '',
        created: now,
        modified: now,
        relativePath,
        filePath,
      };

      await this.saveLocationToFile(location);

      const updated = [...this.locationsSubject.value, location].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      this.locationsSubject.next(updated);

      return location;
    } catch (error) {
      this.logger.error('Failed to create location', error);
      throw new Error(`Failed to create location: ${error}`);
    }
  }

  async updateLocation(id: string, data: Partial<LocationFormData>): Promise<Location | null> {
    try {
      if (data.books) {
        await this.validateBookReferences(data.books);
      }

      const locations = this.locationsSubject.value;
      const existing = locations.find((loc) => loc.id === id);
      const index = existing ? locations.findIndex((loc) => loc.id === existing.id) : -1;

      if (!existing || index === -1) {
        return null;
      }

      let newFilePath = existing.filePath;
      let newRelativePath = existing.relativePath;
      const nameChanged = data.name && data.name !== existing.name;

      if (nameChanged) {
        const newName = data.name || existing.name;
        const newFilename = `_${asciiSlugify(newName) || 'location'}.md`;
        const lastSlash = existing.relativePath.lastIndexOf('/');
        const oldRelDir = lastSlash === -1 ? '' : existing.relativePath.slice(0, lastSlash);
        newRelativePath = oldRelDir ? pathJoin(oldRelDir, newFilename) : newFilename;

        const destFilePath = pathJoin(pathDirname(existing.filePath), newFilename);
        const moveResult = await this.electronService.moveDirectory(existing.filePath, destFilePath);
        if (!moveResult.success) {
          throw new Error(`Failed to move location file: ${moveResult.error}`);
        }
        newFilePath = destFilePath;
      }

      const nextThumbnail =
        'thumbnail' in data
          ? data.thumbnail?.trim() || undefined
          : existing.thumbnail;

      const updatedLocation: Location = {
        ...existing,
        name: data.name ?? existing.name,
        books: data.books ?? existing.books,
        thumbnail: nextThumbnail,
        content: data.content !== undefined ? data.content : existing.content,
        modified: new Date(),
        relativePath: newRelativePath,
        filePath: newFilePath,
      };

      await this.saveLocationToFile(updatedLocation);

      if ('thumbnail' in data && (data.thumbnail || undefined) !== (existing.thumbnail || undefined)) {
        this.thumbnailDataUrls.delete(existing.id);
      }

      const updatedLocations = [...locations];
      updatedLocations[index] = updatedLocation;
      this.locationsSubject.next(
        updatedLocations.sort((a, b) => a.name.localeCompare(b.name))
      );

      return updatedLocation;
    } catch (error) {
      this.logger.error('Failed to update location', error);
      throw new Error(`Failed to update location: ${error}`);
    }
  }

  async deleteLocation(id: string): Promise<boolean> {
    try {
      const locations = this.locationsSubject.value;
      const location = locations.find((loc) => loc.id === id);
      if (!location) {
        return false;
      }

      const deleteResult = await this.electronService.deleteFile(location.filePath);
      if (!deleteResult.success) {
        throw new Error(`Failed to delete location: ${deleteResult.error}`);
      }

      this.thumbnailDataUrls.delete(location.id);
      this.locationsSubject.next(locations.filter((loc) => loc.id !== location.id));
      return true;
    } catch (error) {
      this.logger.error('Failed to delete location', error);
      throw new Error(`Failed to delete location: ${error}`);
    }
  }

  async refreshLocation(id: string): Promise<Location | null> {
    try {
      const locations = this.locationsSubject.value;
      const existing = locations.find((loc) => loc.id === id);
      if (!existing) {
        return null;
      }

      const loaded = await this.loadLocationFromFile(existing.filePath, existing.relativePath);
      if (!loaded) {
        return null;
      }

      const index = locations.findIndex((loc) => loc.id === id);
      if (index === -1) {
        return null;
      }

      const updated = [...locations];
      updated[index] = loaded.location;
      this.locationsSubject.next(updated.sort((a, b) => a.name.localeCompare(b.name)));
      this.thumbnailDataUrls.delete(id);
      return loaded.location;
    } catch (error) {
      this.logger.error('Failed to refresh location', error);
      return null;
    }
  }

  getCachedThumbnail(locationId: string): string | null {
    return this.thumbnailDataUrls.get(locationId) || null;
  }

  async loadThumbnailForLocation(location: Location): Promise<string | null> {
    if (!location.thumbnail) {
      return null;
    }
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return null;
    }
    const parsed = parseThumbnailReference(location.thumbnail);
    if (!parsed) {
      return null;
    }
    const absolutePath = resolveThumbnailPath(project.path, parsed);
    try {
      const dataUrl = await this.electronService.getImageAsDataUrl(absolutePath);
      if (dataUrl) {
        this.thumbnailDataUrls.set(location.id, dataUrl);
        return dataUrl;
      }
    } catch (error) {
      this.logger.error(`Failed to load thumbnail for location ${location.name}:`, error);
    }
    return null;
  }

  async loadThumbnailsForLocations(locations: Location[]): Promise<void> {
    const toLoad = locations.filter(
      (loc) => !!loc.thumbnail && !this.thumbnailDataUrls.has(loc.id)
    );
    await Promise.all(toLoad.map((loc) => this.loadThumbnailForLocation(loc)));
  }

  private async loadLocationFromFile(
    absolutePath: string,
    relativePath: string
  ): Promise<{ location: Location; assignedId: boolean } | null> {
    try {
      const readResult = await this.electronService.readFile(absolutePath);
      if (!readResult.success) {
        this.logger.error(`Failed to read location file ${absolutePath}:`, readResult.error);
        return null;
      }

      const parseResult = parseMarkdown<LocationFrontmatter>(readResult.content!);
      if (!parseResult.success) {
        this.logger.error(`Failed to parse location file ${absolutePath}:`, parseResult.error);
        return null;
      }

      const { frontmatter, content } = parseResult.data!;
      if (!frontmatter.name) {
        this.logger.error(`Location file missing required name field: ${absolutePath}`);
        return null;
      }

      const { created, modified } = await this.resolveTimestamps(
        absolutePath,
        frontmatter.created,
        frontmatter.modified
      );
      const storedId = typeof frontmatter.id === 'string' ? frontmatter.id.trim() : '';
      const assignedId = !storedId;
      const thumbnail =
        typeof frontmatter.thumbnail === 'string' ? frontmatter.thumbnail.trim() : '';

      const location: Location = {
        id: storedId || generateId(),
        name: frontmatter.name,
        books: frontmatter.books || [],
        thumbnail: thumbnail || undefined,
        content: content || '',
        created,
        modified,
        relativePath: normalizeLocationRelativePath(relativePath),
        filePath: absolutePath,
      };

      return { location, assignedId };
    } catch (error) {
      this.logger.error(`Failed to load location from ${absolutePath}`, error);
      return null;
    }
  }

  private assignUniqueLocationIds(locations: Location[], needsIdPersist: Location[]): void {
    const seen = new Set<string>();
    for (const location of locations) {
      if (!location.id || seen.has(location.id)) {
        location.id = generateId();
        if (!needsIdPersist.includes(location)) {
          needsIdPersist.push(location);
        }
      }
      seen.add(location.id);
    }
  }

  private async resolveTimestamps(
    absolutePath: string,
    createdRaw?: string,
    modifiedRaw?: string
  ): Promise<{ created: Date; modified: Date }> {
    let created = createdRaw ? new Date(createdRaw) : null;
    let modified = modifiedRaw ? new Date(modifiedRaw) : null;

    if (created && Number.isNaN(created.getTime())) {
      created = null;
    }
    if (modified && Number.isNaN(modified.getTime())) {
      modified = null;
    }

    if (!created || !modified) {
      const statsResult = await this.electronService.getFileStats(absolutePath);
      if (statsResult.success && statsResult.stats) {
        const ctime = new Date(statsResult.stats.ctime);
        const mtime = new Date(statsResult.stats.mtime);
        if (!created && !Number.isNaN(ctime.getTime())) {
          created = ctime;
        }
        if (!modified && !Number.isNaN(mtime.getTime())) {
          modified = mtime;
        }
      }
    }

    const fallback = new Date();
    return {
      created: created ?? fallback,
      modified: modified ?? created ?? fallback,
    };
  }

  private async saveLocationToFile(location: Location): Promise<void> {
    try {
      const frontmatter: LocationFrontmatter = {
        id: location.id,
        name: location.name,
        books: location.books,
        ...(location.thumbnail ? { thumbnail: location.thumbnail } : {}),
        created: location.created.toISOString(),
        modified: location.modified.toISOString(),
      };

      const markdownContent = generateMarkdown(frontmatter, location.content);
      const writeResult = await this.electronService.writeFileAtomic(location.filePath, markdownContent);
      if (!writeResult.success) {
        throw new Error(writeResult.error);
      }
    } catch (error) {
      throw new Error(`Failed to save location to ${location.filePath}: ${error}`);
    }
  }

  private async validateBookReferences(books: string[]): Promise<void> {
    if (!books || books.length === 0) {
      return;
    }

    const project = requireProject(this.projectService.getCurrentProject());
    const availableBookIds = (project.metadata.books || []).map((book) => book.id);

    for (const bookId of books) {
      if (!availableBookIds.includes(bookId)) {
        throw new Error(`Referenced book '${bookId}' does not exist in project metadata`);
      }
    }
  }

  private async handleFileChange(event: { type: string; path: string; filename: string }): Promise<void> {
    if (!this.currentProjectPath) {
      return;
    }

    if (!event.filename.endsWith('.md') || !event.filename.startsWith('_')) {
      return;
    }

    try {
      const locationsPath = this.projectService.getLocationsFolderPath();
      if (!event.path.startsWith(locationsPath)) {
        return;
      }

      const locations = this.locationsSubject.value;
      const location = locations.find((loc) => loc.filePath === event.path);

      if (event.type === 'unlink') {
        if (location) {
          this.locationsSubject.next(locations.filter((loc) => loc.filePath !== event.path));
          this.thumbnailDataUrls.delete(location.id);
          this.logger.log(`Location removed: ${location.name}`);
        }
      } else if (event.type === 'change' || event.type === 'add') {
        if (location) {
          await this.refreshLocation(location.id);
          this.logger.log(`Location reloaded: ${location.name}`);
        } else {
          await this.forceReloadLocations();
          this.logger.log('Locations reloaded due to new file');
        }
      }
    } catch (error) {
      this.logger.error('Error handling location file change', error);
    }
  }
}
