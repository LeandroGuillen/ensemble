import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  ProjectImage,
  ProjectImageDirectory,
  ProjectImageFolder,
} from '../interfaces';
import { parseThumbnailReference } from '../utils/thumbnail.utils';
import { ImageGenerationService } from './image-generation/image-generation.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

export interface ImagePickerOpenOptions {
  /** Pre-resolved wiki-link or project-relative thumbnail path for initial folder. */
  thumbnailHint?: string;
  /** Project images folder name (e.g. `img`). Defaults to `img`. */
  imagesFolder?: string;
  /** Explicit starting directory under the images root. */
  initialDirectory?: string;
}

export interface ImagePickerState {
  isOpen: boolean;
  isLoading: boolean;
  currentDirectory: string;
  images: ProjectImage[];
  directories: ProjectImageFolder[];
  imagesFolderLabel: string;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

const INITIAL_STATE: ImagePickerState = {
  isOpen: false,
  isLoading: false,
  currentDirectory: '',
  images: [],
  directories: [],
  imagesFolderLabel: 'img',
  error: null,
  canGoBack: false,
  canGoForward: false,
};

@Injectable({
  providedIn: 'root',
})
export class ImagePickerService {
  private readonly stateSubject = new BehaviorSubject<ImagePickerState>(INITIAL_STATE);
  readonly state$ = this.stateSubject.asObservable();

  private history: string[] = [];
  private historyIndex = -1;
  private directoryCache = new Map<string, ProjectImageDirectory>();
  private lastExternalNavigation: {
    direction: 'back' | 'forward';
    timestamp: number;
  } | null = null;

  constructor(
    private imageGenerationService: ImageGenerationService,
    private electronService: ElectronService,
    private projectService: ProjectService
  ) {}

  get snapshot(): ImagePickerState {
    return this.stateSubject.value;
  }

  get isOpen(): boolean {
    return this.snapshot.isOpen;
  }

  get breadcrumbs(): Array<{ label: string; path: string }> {
    const parts = this.snapshot.currentDirectory.split('/').filter(Boolean);
    return parts.map((label, index) => ({
      label,
      path: parts.slice(0, index + 1).join('/'),
    }));
  }

  filterImages(search: string): ProjectImage[] {
    const query = search.trim().toLowerCase();
    return query
      ? this.snapshot.images.filter((image) =>
          image.relativePath.toLowerCase().includes(query)
        )
      : this.snapshot.images;
  }

  filterDirectories(search: string): ProjectImageFolder[] {
    const query = search.trim().toLowerCase();
    return query
      ? this.snapshot.directories.filter((directory) =>
          directory.name.toLowerCase().includes(query)
        )
      : this.snapshot.directories;
  }

  getProjectImageName(image: ProjectImage): string {
    return image.relativePath.split('/').pop() || image.relativePath;
  }

  async open(options: ImagePickerOpenOptions = {}): Promise<void> {
    const imagesFolderLabel =
      options.imagesFolder?.trim() || 'img';
    this.history = [];
    this.historyIndex = -1;
    this.directoryCache.clear();
    this.lastExternalNavigation = null;
    this.patchState({
      ...INITIAL_STATE,
      isOpen: true,
      imagesFolderLabel,
    });
    this.electronService.setBrowserNavigationInterception(true);

    const initialDirectory =
      options.initialDirectory ??
      this.resolveInitialDirectory(options.thumbnailHint, imagesFolderLabel);

    let loaded = await this.loadDirectory(initialDirectory, false);
    if (!loaded && initialDirectory) {
      this.patchState({ error: null });
      loaded = await this.loadDirectory('', false);
    }
    if (loaded && this.isOpen) {
      this.initializeHistory(this.snapshot.currentDirectory);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.electronService.setBrowserNavigationInterception(false);
    this.patchState({ ...INITIAL_STATE });
    this.history = [];
    this.historyIndex = -1;
    this.directoryCache.clear();
    this.lastExternalNavigation = null;
  }

  async loadDirectory(relativeDirectory: string, addToHistory = false): Promise<boolean> {
    const cachedListing = this.directoryCache.get(relativeDirectory);
    if (cachedListing) {
      this.applyDirectory(cachedListing);
      if (addToHistory) {
        this.recordHistory(cachedListing.relativeDirectory);
      }
      return true;
    }

    this.patchState({ isLoading: true, error: null });
    try {
      const listing =
        await this.imageGenerationService.browseProjectImageDirectory(relativeDirectory);
      this.directoryCache.set(listing.relativeDirectory, listing);
      this.applyDirectory(listing);
      if (addToHistory) {
        this.recordHistory(listing.relativeDirectory);
      }
      return true;
    } catch (error) {
      this.patchState({
        error: error instanceof Error ? error.message : 'Failed to load project images',
      });
      return false;
    } finally {
      this.patchState({ isLoading: false });
    }
  }

  openSubdirectory(name: string): void {
    const path = this.snapshot.currentDirectory
      ? `${this.snapshot.currentDirectory}/${name}`
      : name;
    void this.loadDirectory(path, true);
  }

  goToParent(): void {
    const parts = this.snapshot.currentDirectory.split('/').filter(Boolean);
    parts.pop();
    void this.loadDirectory(parts.join('/'), true);
  }

  navigateTo(path: string): void {
    if (path !== this.snapshot.currentDirectory) {
      void this.loadDirectory(path, true);
    }
  }

  goBack(): void {
    if (this.historyIndex <= 0) {
      this.close();
      return;
    }
    void this.restoreHistory(this.historyIndex - 1);
  }

  goForward(): void {
    void this.restoreHistory(this.historyIndex + 1);
  }

  handleExternalNavigation(direction: 'back' | 'forward'): void {
    const timestamp = Date.now();
    if (
      this.lastExternalNavigation?.direction === direction &&
      timestamp - this.lastExternalNavigation.timestamp < 300
    ) {
      return;
    }
    this.lastExternalNavigation = { direction, timestamp };
    direction === 'back' ? this.goBack() : this.goForward();
  }

  /** Used by route guard when navigating away with the picker open. */
  handleNavigationAway(): boolean {
    if (this.isOpen) {
      this.handleExternalNavigation('back');
      return false;
    }
    return !(
      this.lastExternalNavigation?.direction === 'back' &&
      Date.now() - this.lastExternalNavigation.timestamp < 300
    );
  }

  async openCurrentDirectoryInExplorer(): Promise<string | null> {
    const projectPath = this.projectService.getCurrentProject()?.path;
    if (!projectPath || !this.electronService.isElectron()) return null;

    const imagesRoot = this.projectService.getImagesFolderPath();
    const absolutePath = this.snapshot.currentDirectory
      ? await this.electronService.pathJoin(
          imagesRoot,
          ...this.snapshot.currentDirectory.split('/')
        )
      : imagesRoot;
    const result = await this.electronService.openPath(absolutePath);
    return result.success ? null : result.error ?? 'Failed to open folder';
  }

  private resolveInitialDirectory(
    thumbnailHint: string | undefined,
    imagesFolder: string
  ): string {
    const thumbnail = parseThumbnailReference(thumbnailHint?.trim() || '');
    if (!thumbnail) return '';

    const normalizedImagesFolder = imagesFolder
      .replace(/\\/g, '/')
      .replace(/^\.?\/+|\/+$/g, '');
    const thumbnailPath = thumbnail.replace(/\\/g, '/').replace(/^\.?\/+/, '');
    const prefix = `${normalizedImagesFolder}/`;
    if (!thumbnailPath.startsWith(prefix)) return '';

    const parts = thumbnailPath.slice(prefix.length).split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  private applyDirectory(listing: ProjectImageDirectory): void {
    this.patchState({
      currentDirectory: listing.relativeDirectory,
      directories: listing.directories,
      images: listing.images,
    });
    this.updateHistoryFlags();
  }

  private recordHistory(path: string): void {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(path);
    this.historyIndex = this.history.length - 1;
    this.updateHistoryFlags();
  }

  private initializeHistory(path: string): void {
    this.history = [path];
    this.historyIndex = 0;
    this.updateHistoryFlags();
  }

  private async restoreHistory(index: number): Promise<void> {
    if (index < 0 || index >= this.history.length || this.snapshot.isLoading) return;
    const path = this.history[index];
    const listing = this.directoryCache.get(path);
    if (listing) {
      this.historyIndex = index;
      this.applyDirectory(listing);
      return;
    }
    if (await this.loadDirectory(path, false)) {
      this.historyIndex = index;
      this.updateHistoryFlags();
    }
  }

  private updateHistoryFlags(): void {
    this.patchState({
      canGoBack: this.isOpen && this.historyIndex >= 0,
      canGoForward: this.historyIndex < this.history.length - 1,
    });
  }

  private patchState(partial: Partial<ImagePickerState>): void {
    this.stateSubject.next({ ...this.snapshot, ...partial });
  }
}
