import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, distinctUntilChanged, from, map, of, shareReplay, switchMap } from 'rxjs';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';
import { pathExtname, pathJoin, projectRelativePath } from '../utils/path.utils';

/** Basename (without extension) used when copying an icon from outside the project. */
const COPIED_ICON_STEM = 'project-icon';

/**
 * Project icon shown in the sidebar brand. Stored in `ensemble.json` as
 * `projectIcon`: a project-relative image path. Icons picked from outside the
 * project are copied into the images folder first so the project stays portable.
 */
@Injectable({ providedIn: 'root' })
export class ProjectIconService {
  /** Bumped after the icon file is overwritten in place, so the cached data URL refreshes. */
  private readonly revision = new BehaviorSubject(0);

  /** Data URL for the current project's icon, or null for the default Ensemble logo. */
  readonly iconUrl$: Observable<string | null>;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {
    const iconPath$ = this.projectService.currentProject$.pipe(
      map((project) => {
        const relative = project?.metadata?.projectIcon?.trim();
        return project && relative ? pathJoin(project.path, relative) : null;
      }),
      distinctUntilChanged()
    );

    this.iconUrl$ = combineLatest([iconPath$, this.revision]).pipe(
      switchMap(([absolutePath]) =>
        absolutePath ? from(this.loadDataUrl(absolutePath)) : of(null)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** Project-relative path of the current icon, if one is set. */
  getIconPath(): string | null {
    return this.projectService.getCurrentProject()?.metadata?.projectIcon?.trim() || null;
  }

  /**
   * Sets the project icon from an image file. Files already inside the project
   * are referenced in place; anything else is copied into the images folder.
   */
  async setIcon(sourcePath: string): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project is open');
    }

    let relative = projectRelativePath(project.path, sourcePath);
    if (!relative) {
      const ext = pathExtname(sourcePath).toLowerCase() || '.png';
      const imagesFolder = this.projectService.getImagesFolderPath();
      const dest = pathJoin(imagesFolder, `${COPIED_ICON_STEM}${ext}`);
      const created = await this.electronService.createDirectory(imagesFolder);
      if (!created.success) {
        throw new Error(created.error || 'Could not create the images folder');
      }
      const copied = await this.electronService.copyFile(sourcePath, dest);
      if (!copied.success) {
        throw new Error(copied.error || 'Could not copy the image into the project');
      }
      relative = projectRelativePath(project.path, dest) ?? `${COPIED_ICON_STEM}${ext}`;
    }

    await this.projectService.updateMetadata({ projectIcon: relative });
    this.revision.next(this.revision.value + 1);
  }

  /** Goes back to the default Ensemble logo. The image file itself is left alone. */
  async clearIcon(): Promise<void> {
    await this.projectService.updateMetadata({ projectIcon: undefined });
  }

  private async loadDataUrl(absolutePath: string): Promise<string | null> {
    try {
      return await this.electronService.getImageAsDataUrl(absolutePath);
    } catch (error) {
      this.logger.warn('Failed to load project icon', error);
      return null;
    }
  }
}
