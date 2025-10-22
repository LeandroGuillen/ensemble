import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Cast } from '../interfaces/project.interface';
import { slugify, slugifyWithTimestamp } from '../utils/slug.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root',
})
export class CastService {
  private castsSubject = new BehaviorSubject<Cast[]>([]);
  public casts$ = this.castsSubject.asObservable();
  private hasLoadedForCurrentProject = false;
  private currentProjectPath: string | null = null;

  constructor(private electronService: ElectronService, private projectService: ProjectService) {}

  getCasts(): Observable<Cast[]> {
    return this.casts$;
  }

  getCastById(id: string): Cast | undefined {
    return this.castsSubject.value.find((cast) => cast.id === id);
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
      const castsPath = await this.electronService.pathJoin(projectPath, 'casts');

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

      // Load each cast folder (skip _deleted)
      for (const castSlug of dirContents.directories) {
        if (castSlug === '_deleted') {
          continue;
        }

        try {
          const castFolderPath = await this.electronService.pathJoin(castsPath, castSlug);
          const cast = await this.loadCastFromFolder(castFolderPath, castSlug);
          if (cast) {
            folderCasts.push(cast);
          }
        } catch (error) {
          console.warn(`Failed to load cast from ${castSlug}:`, error);
        }
      }

      // Merge with metadata from ensemble.json
      const mergedCasts = await this.mergeCastsWithMetadata(folderCasts, projectPath);

      // Sort casts by name and update the list
      mergedCasts.sort((a, b) => a.name.localeCompare(b.name));
      this.castsSubject.next(mergedCasts);
      this.hasLoadedForCurrentProject = true;
    } catch (error) {
      console.error('Failed to load casts:', error);
      throw new Error(`Failed to load casts: ${error}`);
    }
  }

  /**
   * Merges folder-detected casts with metadata from ensemble.json
   */
  private async mergeCastsWithMetadata(folderCasts: Cast[], projectPath: string): Promise<Cast[]> {
    try {
      // Read ensemble.json to get cast metadata
      const ensemblePath = await this.electronService.pathJoin(projectPath, 'ensemble.json');
      const ensembleExists = await this.electronService.fileExists(ensemblePath);

      let metadataCasts: Cast[] = [];
      if (ensembleExists) {
        const readResult = await this.electronService.readFile(ensemblePath);
        if (readResult.success && readResult.content) {
          try {
            const metadata = JSON.parse(readResult.content);
            metadataCasts = metadata.casts || [];
          } catch (error) {
            console.warn('Failed to parse ensemble.json:', error);
          }
        }
      }

      // Create a map of metadata casts by ID for quick lookup
      const metadataMap = new Map<string, Cast>();
      metadataCasts.forEach((cast) => {
        metadataMap.set(cast.id, cast);
      });

      // Merge folder casts with metadata
      const mergedCasts: Cast[] = [];

      for (const folderCast of folderCasts) {
        const metadataCast = metadataMap.get(folderCast.id);

        if (metadataCast) {
          // Merge: use metadata for name and characterIds, folder data for description, thumbnail, folderPath
          mergedCasts.push({
            ...folderCast,
            name: metadataCast.name,
            characterIds: metadataCast.characterIds || [],
          });
          // Remove from metadata map so we don't process it again
          metadataMap.delete(folderCast.id);
        } else {
          // Check if this folder cast matches any metadata cast by name (for migration)
          const matchingMetadataCast = Array.from(metadataMap.values()).find((mc) => mc.name === folderCast.name);

          if (matchingMetadataCast) {
            // Found a match by name - this is likely a cast created before .castid files
            // Create .castid file for future consistency
            if (folderCast.folderPath) {
              try {
                const castIdPath = await this.electronService.pathJoin(folderCast.folderPath, '.castid');
                await this.electronService.writeFileAtomic(castIdPath, matchingMetadataCast.id);
              } catch (error) {
                console.warn(`Failed to create .castid file for cast ${folderCast.name}:`, error);
              }
            }

            // Use the metadata cast ID and merge data
            mergedCasts.push({
              ...folderCast,
              id: matchingMetadataCast.id,
              name: matchingMetadataCast.name,
              characterIds: matchingMetadataCast.characterIds || [],
            });
            // Remove from metadata map
            metadataMap.delete(matchingMetadataCast.id);
          } else {
            // Folder cast without metadata - use folder data as-is
            mergedCasts.push(folderCast);
          }
        }
      }

      // Add any metadata-only casts (casts in ensemble.json but no folder)
      // These might be casts that were created but their folders were deleted
      for (const [id, metadataCast] of metadataMap) {
        console.warn(`Cast "${metadataCast.name}" exists in metadata but has no folder`);
        // Add it anyway but without folder data
        mergedCasts.push({
          ...metadataCast,
          description: undefined,
          thumbnail: undefined,
          folderPath: undefined,
        });
      }

      return mergedCasts;
    } catch (error) {
      console.error('Failed to merge casts with metadata:', error);
      // Return folder casts as fallback
      return folderCasts;
    }
  }

  /**
   * Creates a new cast and saves it to disk
   * Structure: casts/<cast-slug>/
   */
  async createCast(castData: Omit<Cast, 'id' | 'folderPath' | 'thumbnail'>): Promise<Cast> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    try {
      // Generate unique ID and slug
      const id = this.generateId();
      const slug = slugify(castData.name);

      // Create folder structure: casts/<slug>/
      const castsPath = await this.electronService.pathJoin(project.path, 'casts');
      const castFolderPath = await this.electronService.pathJoin(castsPath, slug);

      // Ensure casts folder exists
      await this.electronService.createDirectory(castsPath);

      // Create cast folder
      const folderCreateResult = await this.electronService.createDirectory(castFolderPath);
      if (!folderCreateResult.success) {
        throw new Error(`Failed to create cast directory: ${folderCreateResult.error}`);
      }

      // Create .castid file to store the cast ID for consistent loading
      const castIdPath = await this.electronService.pathJoin(castFolderPath, '.castid');
      const writeIdResult = await this.electronService.writeFileAtomic(castIdPath, id);
      if (!writeIdResult.success) {
        throw new Error(`Failed to create .castid file: ${writeIdResult.error}`);
      }

      // Always create description.md (even if empty) so the cast can be detected
      const descriptionPath = await this.electronService.pathJoin(castFolderPath, 'description.md');
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

      // Update in-memory list
      const currentCasts = this.castsSubject.value;
      const updatedCasts = [...currentCasts, cast].sort((a, b) => a.name.localeCompare(b.name));
      this.castsSubject.next(updatedCasts);

      return cast;
    } catch (error) {
      console.error('Failed to create cast:', error);
      throw new Error(`Failed to create cast: ${error}`);
    }
  }

  /**
   * Updates an existing cast and saves changes to disk
   */
  async updateCast(id: string, updates: Partial<Omit<Cast, 'id' | 'folderPath'>>): Promise<Cast | null> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

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
        const newSlug = slugify(updates.name);
        const castsPath = await this.electronService.pathJoin(project.path, 'casts');
        const newCastFolderPath = await this.electronService.pathJoin(castsPath, newSlug);

        // Move the entire cast folder
        const moveResult = await this.electronService.moveDirectory(existingCast.folderPath!, newCastFolderPath);
        if (!moveResult.success) {
          throw new Error(`Failed to move cast folder: ${moveResult.error}`);
        }

        newFolderPath = newCastFolderPath;
      }

      // Update description.md if description changed
      if (updates.description !== undefined && updates.description !== existingCast.description) {
        const descriptionPath = await this.electronService.pathJoin(newFolderPath, 'description.md');
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

      // Update in-memory list
      casts[index] = updatedCast;
      const sortedCasts = [...casts].sort((a, b) => a.name.localeCompare(b.name));
      this.castsSubject.next(sortedCasts);

      return updatedCast;
    } catch (error) {
      console.error('Failed to update cast:', error);
      throw new Error(`Failed to update cast: ${error}`);
    }
  }

  /**
   * Deletes a cast by moving it to the trash folder
   * Trash folder: casts/_deleted/<cast-slug>-<timestamp>/
   */
  async deleteCast(id: string): Promise<boolean> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    try {
      const casts = this.castsSubject.value;
      const cast = casts.find((c) => c.id === id);

      if (!cast) {
        console.warn(`Cast with ID '${id}' not found in CastService`);
        return false;
      }

      // If cast has a folder, move it to trash
      if (cast.folderPath) {
        // Create trash folder if it doesn't exist
        const trashPath = await this.electronService.pathJoin(project.path, 'casts', '_deleted');
        await this.electronService.createDirectory(trashPath);

        // Generate unique trash folder name with timestamp
        const castSlug = slugify(cast.name);
        const trashFolderName = slugifyWithTimestamp(castSlug);
        const trashDestPath = await this.electronService.pathJoin(trashPath, trashFolderName);

        // Move cast folder to trash
        const moveResult = await this.electronService.moveDirectory(cast.folderPath, trashDestPath);
        if (!moveResult.success) {
          throw new Error(`Failed to move cast to trash: ${moveResult.error}`);
        }
      } else {
        console.warn(`Cast '${cast.name}' has no folder to delete - removing from memory only`);
      }

      // Update in-memory list (remove cast regardless of whether it had a folder)
      const filteredCasts = casts.filter((c) => c.id !== id);
      this.castsSubject.next(filteredCasts);

      return true;
    } catch (error) {
      console.error('Failed to delete cast:', error);
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
      const originalFilename = await this.electronService.pathBasename(thumbnailPath);
      const extension = originalFilename.split('.').pop() || 'jpg';
      const thumbnailFilename = `thumbnail.${extension}`;

      // Create destination path in cast folder
      const destPath = await this.electronService.pathJoin(cast.folderPath, thumbnailFilename);

      // Copy file to cast folder
      const copyResult = await this.electronService.copyFile(thumbnailPath, destPath);
      if (!copyResult.success) {
        throw new Error(copyResult.error);
      }

      // Update cast in memory
      const casts = this.castsSubject.value;
      const index = casts.findIndex((c) => c.id === castId);
      if (index !== -1) {
        casts[index] = { ...casts[index], thumbnail: thumbnailFilename };
        this.castsSubject.next([...casts]);
      }

      return thumbnailFilename;
    } catch (error) {
      console.error('Failed to add thumbnail:', error);
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
      const thumbnailPath = await this.electronService.pathJoin(cast.folderPath, cast.thumbnail);
      const exists = await this.electronService.fileExists(thumbnailPath);

      if (exists) {
        const deleteResult = await this.electronService.deleteFile(thumbnailPath);
        if (!deleteResult.success) {
          console.warn('Failed to delete thumbnail:', deleteResult.error);
        }
      }

      // Re-detect thumbnail (might find another image)
      const newThumbnail = await this.detectThumbnail(cast.folderPath);

      // Update cast in memory
      const casts = this.castsSubject.value;
      const index = casts.findIndex((c) => c.id === castId);
      if (index !== -1) {
        casts[index] = {
          ...casts[index],
          thumbnail: newThumbnail || undefined,
        };
        this.castsSubject.next([...casts]);
      }

      return true;
    } catch (error) {
      console.error('Failed to remove thumbnail:', error);
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
      console.error('Failed to detect thumbnail:', error);
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
      const descriptionPath = await this.electronService.pathJoin(folderPath, 'description.md');
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
      const castIdPath = await this.electronService.pathJoin(folderPath, '.castid');
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
      console.error(`Failed to load cast from ${folderPath}:`, error);
      return null;
    }
  }

  /**
   * Extracts ID from slug
   */
  private extractIdFromSlug(slug: string): string {
    return slug.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
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
