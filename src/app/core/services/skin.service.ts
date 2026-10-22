import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { Skin } from '../interfaces/skin.interface';
import { skins, getSkinById, getDefaultSkin, DEFAULT_SKIN_ID } from '../skins';
import { MetadataService } from './metadata.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

/**
 * Applies the UI skin (shape/type/motion layer, independent of the color theme)
 * by setting `data-skin` on the document root. Persisted per project in settings.
 */
@Injectable({
  providedIn: 'root'
})
export class SkinService {
  private currentSkinSubject = new BehaviorSubject<Skin>(getDefaultSkin());
  public currentSkin$: Observable<Skin> = this.currentSkinSubject.asObservable();

  private currentProjectPath: string | null = null;

  constructor(
    private metadataService: MetadataService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {
    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe(project => {
      if (project) {
        if (project.path !== this.currentProjectPath) {
          this.currentProjectPath = project.path;
          this.initialize();
        }
      } else {
        this.currentProjectPath = null;
        this.applySkin(getDefaultSkin());
      }
    });
  }

  /**
   * Initialize skin from project settings
   */
  initialize(): void {
    const skinId = this.metadataService.getSettings()?.skin || DEFAULT_SKIN_ID;
    this.applySkin(getSkinById(skinId) || getDefaultSkin());
  }

  getAvailableSkins(): Skin[] {
    return [...skins];
  }

  getCurrentSkin(): Skin {
    return this.currentSkinSubject.value;
  }

  /**
   * Set skin by ID
   */
  async setSkin(skinId: string): Promise<void> {
    const skin = getSkinById(skinId);
    if (!skin) {
      throw new Error(`Skin not found: ${skinId}`);
    }

    this.applySkin(skin);

    try {
      await this.metadataService.updateSettings({ skin: skinId });
    } catch (error) {
      this.logger.error('Failed to save skin preference', error);
    }
  }

  private applySkin(skin: Skin): void {
    const root = document.documentElement;
    if (skin.id === DEFAULT_SKIN_ID) {
      delete root.dataset['skin'];
    } else {
      root.dataset['skin'] = skin.id;
    }
    this.currentSkinSubject.next(skin);
  }
}
