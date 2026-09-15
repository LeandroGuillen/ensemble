import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Cast } from '../interfaces/project.interface';
import { asciiSlugify } from '../utils/slug.utils';
import { generateId } from '../utils/id.utils';
import { pathBasename, pathJoin } from '../utils/path.utils';
import { assertIpcSuccess } from '../utils/ipc.utils';
import { requireProject } from '../utils/project.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

/** Entry for a cast in casts.json (name/characterIds live there; folder holds description + thumbnails). */
export interface CastIndexEntry {
  id: string;
  name: string;
  characterIds?: string[];
}

interface CastsFile {
  version: number;
  casts: CastIndexEntry[];
}

@Injectable({
  providedIn: 'root',
})
export class CastService {
  private castsSubject = new BehaviorSubject<Cast[]>([]);
  public casts$ = this.castsSubject.asObservable();
  private hasLoadedForCurrentProject = false;
  private currentProjectPath: string | null = null;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {}

  getCasts(): Observable<Cast[]> {
    return this.casts$;
  }

  getCastById(id: string): Cast | undefined {
    return this.castsSubject.value.find((cast) => cast.id === id);
  }

  /** Synchronous snapshot of the currently loaded casts. */
  getCastsSnapshot(): Cast[] {
    return this.castsSubject.value;
  }

  /** Absolute path of the casts.json index file inside the casts folder. */
  private getCastsJsonPath(): string {
    return pathJoin(this.projectService.getCastsFolderPath(), 'casts.json');
  }

  /** Reads and parses casts.json; returns null when missing or unreadable. */
  private async readCastsFile(): Promise<CastsFile | null> {
    try {
      const exists = await this.electronService.fileExists(this.getCastsJsonPath());
      if (!exists) {
        return null;
      }
      const readResult = await this.electronService.readFile(this.getCastsJsonPath());
      if (!readResult.success || !readResult.content) {
        return null;
      }
      const parsed = JSON.parse(readResult.content) as Partial<CastsFile>;
      if (!parsed || !Array.isArray(parsed.casts)) {
        return null;
      }
      return {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        casts: parsed.casts
          .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            characterIds: Array.isArray(entry.characterIds) ? entry.characterIds : [],
          })),
      };
    } catch (error) {
      this.logger.warn('Failed to read casts.json:', error);
      return null;
    }
  }

  /** Atomically writes the casts.json index file. */
  private async writeCastsFile(entries: CastIndexEntry[]): Promise<void> {
    const data: CastsFile = { version: 1, casts: entries };
    const result = await this.electronService.writeFileAtomic(
      this.getCastsJsonPath(),
      JSON.stringify(data, null, 2)
    );
    if (!result.success) {
      throw new Error(`Failed to write casts.json: ${result.error}`);
    }
  }

  private async upsertCastsFileEntry(cast: { id: string; name: string; characterIds: string[] }): Promise<void> {
    const current = await this.readCastsFile();
    const entries = current?.casts || [];
    const index = entries.findIndex((entry) => entry.id === cast.id);
    const entry: CastIndexEntry = {
      id: cast.id,
      name: cast.name,
      characterIds: cast.characterIds,
    };
    if (index !== -1) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
    await this.writeCastsFile(entries);
  }

  private async removeCastsFileEntry(id: string): Promise<void> {
    const current = await this.readCastsFile();
    if (!current) {
      return;
    }
    const filtered = current.casts.filter((entry) => entry.id !== id);
    if (filtered.length !== current.casts.length) {
      await this.writeCastsFile(filtered);
    }
  }

  /**
   * Forces a reload of casts from disk
   */
  async forceReloadCasts(): Promise<void> {
    this.hasLoadedForCurrentProject = false;
    if (this.currentProjectPath) {
      this.castsSubject.next([]);
      await this.loadCasts(this.currentProjectPath);
    }
  }

  /**
   * Loads all casts from the casts directory
   * Structure: casts/<cast-slug>/
   */
  async loadCasts(projectPath: string): Promise<void> {
    // If this is the same project and we've already loaded, don't reload
    if (this.currentProjectPath === projectPath && this.hasLoadedForCurrentProject) {
      return;
    }

    // If this is a different project, reset the state
    if (this.currentProjectPath !== projectPath) {
      this.currentProjectPath = projectPath;
      this.hasLoadedForCurrentProject = false;
      this.castsSubject.next([]);
    }

    try {
      const castsPath = this.projectService.getCastsFolderPath();

      // Check if casts directory exists
      const dirExists = await this.electronService.fileExists(castsPath);
      if (!dirExists) {
        // Create casts directory if it doesn't exist
        const createResult = await this.electronService.createDirectory(castsPath);
        if (!createResult.success) {
          throw new Error(`Failed to create casts directory: ${createResult.error}`);
        }
        this.hasLoadedForCurrentProject = true;
        return;
      }

      // Read all cast folders
      const dirContents = await this.electronService.readDirectoryFiles(castsPath);
      if (!dirContents.success || !dirContents.directories) {
        this.hasLoadedForCurrentProject = true;
        return;
      }

      const folderCasts: Cast[] = [];

      // Load each cast folder (ignore any leftover _deleted folder from the removed trash feature)
      for (const castSlug of dirContents.directories) {
        if (castSlug === '_deleted') {
          continue;
        }

        try {
          const castFolderPath = pathJoin(castsPath, castSlug);
          const cast = await this.loadCastFromFolder(castFolderPath, castSlug);
          if (cast) {
            folderCasts.push(cast);
          }
        } catch (error) {
          this.logger.warn(`Failed to load cast from ${castSlug}:`, error);
        }
      }

      // Merge with metadata from ensemble.json
      const mergedCasts = await this.mergeCastsWithMetadata(folderCasts, projectPath);

      // Sort casts by name and update the list
      mergedCasts.sort((a, b) => a.name.localeCompare(b.name));
      this.castsSubject.next(mergedCasts);
      this.hasLoadedForCurrentProject = true;
    } catch (error) {
      this.logger.error('Failed to load casts:', error);
      throw new Error(`Failed to load casts: ${error}`);
    }
  }

  /**
   * Merges folder-detected casts with metadata from casts.json.
   * Folders are the source of truth for existence; casts.json supplies
   * name and characterIds. When casts.json is missing, legacy ensemble.json
   * metadata is used to migrate the index into casts.json.
   */
  private async mergeCastsWithMetadata(folderCasts: Cast[], _projectPath: string): Promise<Cast[]> {
    try {
      let castsFile = await this.readCastsFile();
      const legacyCasts = this.projectService.getCurrentProject()?.metadata.casts || [];
      let pendingMigrationNameMap: Map<string, string> | null = null;

      // Migration: bootstrap casts.json from legacy ensemble.json metadata
      if (!castsFile && legacyCasts.length > 0) {
        castsFile = {
          version: 1,
          casts: legacyCasts.map((cast) => ({
            id: cast.id,
            name: cast.name,
            characterIds: cast.characterIds || [],
          })),
        };
        // Legacy projects referenced casts by ensemble.json ids; keep a
        // name-based map so folders without .castid files can adopt them.
        pendingMigrationNameMap = new Map(
          legacyCasts.map((cast) => [cast.name, cast.id])
        );
        try {
          await this.writeCastsFile(castsFile.casts);
        } catch (error) {
          this.logger.warn('Failed to bootstrap casts.json from ensemble.json:', error);
        }
      }

      const indexMap = new Map<string, CastIndexEntry>();
      castsFile?.casts.forEach((entry) => indexMap.set(entry.id, entry));

      const mergedCasts: Cast[] = [];
      const matchedIndexIds = new Set<string>();

      for (const folderCast of folderCasts) {
        const entry = indexMap.get(folderCast.id);
        if (entry) {
          matchedIndexIds.add(entry.id);
          mergedCasts.push({
            ...folderCast,
            name: entry.name,
            characterIds: entry.characterIds || [],
          });
        } else {
          // Folder without an index slot: adopt a legacy id during migration
          // (matched by name) so existing references keep working.
          const legacyId = pendingMigrationNameMap?.get(folderCast.name);
          if (legacyId && indexMap.has(legacyId)) {
            if (folderCast.folderPath) {
              try {
                await this.electronService.writeFileAtomic(pathJoin(folderCast.folderPath, '.castid'), legacyId);
              } catch (error) {
                this.logger.warn(`Failed to create .castid file for cast ${folderCast.name}:`, error);
              }
            }
            const migratedEntry = indexMap.get(legacyId)!;
            matchedIndexIds.add(legacyId);
            mergedCasts.push({
              ...folderCast,
              id: legacyId,
              name: migratedEntry.name,
              characterIds: migratedEntry.characterIds || [],
            });
          } else {
            // New folder (external creation) without an index entry yet
            mergedCasts.push({
              ...folderCast,
              characterIds: [],
            });
            try {
              await this.upsertCastsFileEntry({
                id: folderCast.id,
                name: folderCast.name,
                characterIds: [],
              });
            } catch (error) {
              this.logger.warn(`Failed to add cast ${folderCast.name} to casts.json:`, error);
            }
          }
        }
      }

      // Index entries without a folder: keep them listed (folder may be
      // externally deleted) but without folder data, as before.
      for (const entry of indexMap.values()) {
        if (matchedIndexIds.has(entry.id)) {
          continue;
        }
        this.logger.warn(`Cast "${entry.name}" exists in casts.json but has no folder`);
        mergedCasts.push({
          id: entry.id,
          name: entry.name,
          characterIds: entry.characterIds || [],
        });
      }

      return mergedCasts;
    } catch (error) {
      this.logger.error('Failed to merge casts with metadata:', error);
      // Return folder casts as fallback
      return folderCasts;
    }
  }

  /**
   * Creates a new cast and saves it to disk
   * Structure: casts/<cast-slug>/
   */
  async createCast(castData: Omit<Cast, 'id' | 'folderPath' | 'thumbnail'>): Promise<Cast> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      // Generate unique ID and slug
      const id = generateId();
      const slug = asciiSlugify(castData.name) || 'cast';

      // Create folder structure: charactersFolder/castsFolder/<slug>/
      const castsPath = this.projectService.getCastsFolderPath();
      const castFolderPath = pathJoin(castsPath, slug);

      // Ensure casts folder exists
      await this.electronService.createDirectory(castsPath);

      // Create cast folder
      const folderCreateResult = await this.electronService.createDirectory(castFolderPath);
      if (!folderCreateResult.success) {
        throw new Error(`Failed to create cast directory: ${folderCreateResult.error}`);
      }

      // Create .castid file to store the cast ID for consistent loading
      const castIdPath = pathJoin(castFolderPath, '.castid');
      const writeIdResult = await this.electronService.writeFileAtomic(castIdPath, id);
      if (!writeIdResult.success) {
        throw new Error(`Failed to create .castid file: ${writeIdResult.error}`);
      }

      // Always create description.md (even if empty) so the cast can be detected
      const descriptionPath = pathJoin(castFolderPath, 'description.md');
      const descriptionContent = castData.description || '';
      const writeResult = await this.electronService.writeFileAtomic(descriptionPath, descriptionContent);
      if (!writeResult.success) {
        throw new Error(`Failed to create description.md: ${writeResult.error}`);
      }

      // Detect thumbnail
      const thumbnail = await this.detectThumbnail(castFolderPath);

      // Create cast object
      const cast: Cast = {
        id,
        name: castData.name,
        characterIds: castData.characterIds || [],
        description: castData.description,
        thumbnail: thumbnail || undefined,
        folderPath: castFolderPath,
      };

      // Register the cast in the casts.json index
      await this.upsertCastsFileEntry({
        id,
        name: cast.name,
        characterIds: cast.characterIds,
      });

      // Update in-memory list
      const currentCasts = this.castsSubject.value;
      const updatedCasts = [...currentCasts, cast].sort((a, b) => a.name.localeCompare(b.name));
      this.castsSubject.next(updatedCasts);

      return cast;
    } catch (error) {
      this.logger.error('Failed to create cast:', error);
      throw new Error(`Failed to create cast: ${error}`);
    }
  }

  /**
   * Updates an existing cast and saves changes to disk
   */
  async updateCast(id: string, updates: Partial<Omit<Cast, 'id' | 'folderPath'>>): Promise<Cast | null> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const casts = this.castsSubject.value;
      const index = casts.findIndex((cast) => cast.id === id);

      if (index === -1) {
        return null;
      }

      const existingCast = casts[index];
      let newFolderPath = existingCast.folderPath!;

      // Check if we need to move the folder (name changed)
      const nameChanged = updates.name && updates.name !== existingCast.name;

      if (nameChanged && updates.name) {
        const newSlug = asciiSlugify(updates.name) || 'cast';
        const castsPath = this.projectService.getCastsFolderPath();
        const newCastFolderPath = pathJoin(castsPath, newSlug);

        // Move the entire cast folder
        const moveResult = await this.electronService.moveDirectory(existingCast.folderPath!, newCastFolderPath);
        if (!moveResult.success) {
          throw new Error(`Failed to move cast folder: ${moveResult.error}`);
        }

        newFolderPath = newCastFolderPath;
      }

      // Update description.md if description changed
      if (updates.description !== undefined && updates.description !== existingCast.description) {
        const descriptionPath = pathJoin(newFolderPath, 'description.md');
        if (updates.description) {
          const writeResult = await this.electronService.writeFileAtomic(descriptionPath, updates.description);
          if (!writeResult.success) {
            throw new Error(`Failed to update description.md: ${writeResult.error}`);
          }
        } else {
          // Delete description.md if description is cleared
          const fileExists = await this.electronService.fileExists(descriptionPath);
          if (fileExists) {
            await this.electronService.deleteFile(descriptionPath);
          }
        }
      }

      // Detect thumbnail (in case new images were added)
      const thumbnail = await this.detectThumbnail(newFolderPath);

      // Create updated cast
      const updatedCast: Cast = {
        ...existingCast,
        ...updates,
        thumbnail: thumbnail || undefined,
        folderPath: newFolderPath,
      };

      // Persist name/characterIds changes to the casts.json index
      await this.upsertCastsFileEntry({
        id: updatedCast.id,
        name: updatedCast.name,
        characterIds: updatedCast.characterIds || [],
      });

      // Update in-memory list
      const updatedCasts = [...casts];
      updatedCasts[index] = updatedCast;
      const sortedCasts = updatedCasts.sort((a, b) => a.name.localeCompare(b.name));
      this.castsSubject.next(sortedCasts);

      return updatedCast;
    } catch (error) {
      this.logger.error('Failed to update cast:', error);
      throw new Error(`Failed to update cast: ${error}`);
    }
  }

  /**
   * Deletes a cast and its folder from disk.
   */
  async deleteCast(id: string): Promise<boolean> {
    const project = requireProject(this.projectService.getCurrentProject());

    try {
      const casts = this.castsSubject.value;
      const cast = casts.find((c) => c.id === id);

      if (!cast) {
        this.logger.warn(`Cast with ID '${id}' not found in CastService`);
        return false;
      }

      // If cast has a folder, delete it recursively from disk
      if (cast.folderPath) {
        const deleteResult = await this.electronService.deleteDirectoryRecursive(cast.folderPath);
        if (!deleteResult.success) {
          throw new Error(`Failed to delete cast folder: ${deleteResult.error}`);
        }
      } else {
        this.logger.warn(`Cast '${cast.name}' has no folder to delete - removing from memory only`);
      }

      // Remove the cast from the casts.json index
      await this.removeCastsFileEntry(id);

      // Update in-memory list (remove cast regardless of whether it had a folder)
      const filteredCasts = casts.filter((c) => c.id !== id);
      this.castsSubject.next(filteredCasts);

      return true;
    } catch (error) {
      this.logger.error('Failed to delete cast:', error);
      throw new Error(`Failed to delete cast: ${error}`);
    }
  }

  /**
   * Adds a thumbnail file to a cast folder
   */
  async addThumbnail(castId: string, thumbnailPath: string): Promise<string | null> {
    const cast = this.getCastById(castId);
    if (!cast || !cast.folderPath) {
      throw new Error('Cast not found');
    }

    try {
      // Get original filename and extension
      const originalFilename = pathBasename(thumbnailPath);
      const extension = originalFilename.split('.').pop() || 'jpg';
      const thumbnailFilename = `thumbnail.${extension}`;

      // Create destination path in cast folder
      const destPath = pathJoin(cast.folderPath, thumbnailFilename);

      // Copy file to cast folder
      const copyResult = await this.electronService.copyFile(thumbnailPath, destPath);
      if (!copyResult.success) {
        throw new Error(copyResult.error);
      }

      // Update cast in memory
      const casts = this.castsSubject.value;
      const index = casts.findIndex((c) => c.id === castId);
      if (index !== -1) {
        const updatedCasts = [...casts];
        updatedCasts[index] = { ...updatedCasts[index], thumbnail: thumbnailFilename };
        this.castsSubject.next(updatedCasts);
      }

      return thumbnailFilename;
    } catch (error) {
      this.logger.error('Failed to add thumbnail:', error);
      throw new Error(`Failed to add thumbnail: ${error}`);
    }
  }

  /**
   * Removes the thumbnail from a cast
   */
  async removeThumbnail(castId: string): Promise<boolean> {
    const cast = this.getCastById(castId);
    if (!cast || !cast.folderPath || !cast.thumbnail) {
      return false;
    }

    try {
      // Delete the thumbnail file
      const thumbnailPath = pathJoin(cast.folderPath, cast.thumbnail);
      const exists = await this.electronService.fileExists(thumbnailPath);

      if (exists) {
        const deleteResult = await this.electronService.deleteFile(thumbnailPath);
        if (!deleteResult.success) {
          this.logger.warn('Failed to delete thumbnail:', deleteResult.error);
        }
      }

      // Re-detect thumbnail (might find another image)
      const newThumbnail = await this.detectThumbnail(cast.folderPath);

      // Update cast in memory
      const casts = this.castsSubject.value;
      const index = casts.findIndex((c) => c.id === castId);
      if (index !== -1) {
        const updatedCasts = [...casts];
        updatedCasts[index] = {
          ...updatedCasts[index],
          thumbnail: newThumbnail || undefined,
        };
        this.castsSubject.next(updatedCasts);
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to remove thumbnail:', error);
      return false;
    }
  }

  /**
   * Detects thumbnail in cast folder
   * Priority: 1) thumbnail.* 2) first image file found
   */
  async detectThumbnail(castFolderPath: string): Promise<string | undefined> {
    try {
      const dirContents = await this.electronService.readDirectoryFiles(castFolderPath);
      if (!dirContents.success || !dirContents.files) {
        return undefined;
      }

      const files = dirContents.files;

      // 1. Look for explicit thumbnail.* (png, jpg, jpeg, webp)
      const explicitThumbnail = files.find((f) => f.match(/^thumbnail\.(png|jpg|jpeg|webp)$/i));
      if (explicitThumbnail) {
        return explicitThumbnail;
      }

      // 2. Fall back to first image file found
      const firstImage = files.find((f) => f.match(/\.(png|jpg|jpeg|webp|gif)$/i));
      return firstImage || undefined;
    } catch (error) {
      this.logger.error('Failed to detect thumbnail:', error);
      return undefined;
    }
  }

  /**
   * Loads a cast from a folder
   */
  private async loadCastFromFolder(folderPath: string, castSlug: string): Promise<Cast | null> {
    try {
      // Verify the folder exists and is actually a directory
      const folderExists = await this.electronService.fileExists(folderPath);
      if (!folderExists) {
        return null;
      }

      // Read description.md if it exists (optional)
      let description: string | undefined;
      const descriptionPath = pathJoin(folderPath, 'description.md');
      const descriptionExists = await this.electronService.fileExists(descriptionPath);

      if (descriptionExists) {
        const readResult = await this.electronService.readFile(descriptionPath);
        if (readResult.success && readResult.content) {
          description = readResult.content;
        }
      }

      // Detect thumbnail (optional)
      const thumbnail = await this.detectThumbnail(folderPath);

      // Try to read cast ID from .castid file, fallback to generating from slug
      let id: string;
      const castIdPath = pathJoin(folderPath, '.castid');
      const castIdExists = await this.electronService.fileExists(castIdPath);

      if (castIdExists) {
        const readIdResult = await this.electronService.readFile(castIdPath);
        if (readIdResult.success && readIdResult.content?.trim()) {
          id = readIdResult.content.trim();
        } else {
          // Fallback to generating from slug for older casts
          id = this.extractIdFromSlug(castSlug);
        }
      } else {
        // Fallback to generating from slug for older casts
        id = this.extractIdFromSlug(castSlug);
      }

      // Note: We don't load characterIds here - that comes from ensemble.json
      // via MetadataService. This service only handles folder-based data.
      const cast: Cast = {
        id,
        name: castSlug.replace(/-/g, ' '), // Temporary - will be overridden by ensemble.json
        characterIds: [], // Will be populated from ensemble.json
        description,
        thumbnail: thumbnail || undefined,
        folderPath,
      };

      return cast;
    } catch (error) {
      this.logger.error(`Failed to load cast from ${folderPath}:`, error);
      return null;
    }
  }

  /**
   * Extracts ID from slug
   */
  private extractIdFromSlug(slug: string): string {
    return slug.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }


  /**
   * Rewrites leftover path-based character refs in casts.json to stable ids.
   * No-op (and no write) when nothing matches.
   */
  async remapCharacterIds(idMap: ReadonlyMap<string, string>): Promise<void> {
    if (idMap.size === 0) {
      return;
    }

    try {
      const current = await this.readCastsFile();
      if (!current) {
        return;
      }

      let changed = false;
      const entries = current.casts.map((entry) => {
        const ids = entry.characterIds || [];
        const nextIds = ids.map((id) => {
          const next = idMap.get(id) ?? idMap.get(id.replace(/\\/g, '/')) ?? id;
          if (next !== id) {
            changed = true;
          }
          return next;
        });
        return { ...entry, characterIds: nextIds };
      });

      if (changed) {
        await this.writeCastsFile(entries);
      }
    } catch (error) {
      this.logger.error('Failed to remap character ids in casts.json', error);
    }

    // Keep the in-memory state consistent with the rewritten index
    try {
      await this.forceReloadCasts();
    } catch (error) {
      this.logger.error('Failed to reload casts after character id remap', error);
    }
  }

  /**
   * Resets the service state
   */
  reset(): void {
    this.castsSubject.next([]);
    this.currentProjectPath = null;
    this.hasLoadedForCurrentProject = false;
  }
}
