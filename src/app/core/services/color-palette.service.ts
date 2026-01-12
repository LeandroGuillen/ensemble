import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ColorPaletteConfig } from '../interfaces/color-palette.interface';
import { MetadataService } from './metadata.service';
import { ProjectService } from './project.service';
import { ThemeService } from './theme.service';
import { DEFAULT_BASE_COLORS } from '../utils/color-palette.utils';

@Injectable({
  providedIn: 'root'
})
export class ColorPaletteService {
  private paletteSubject = new BehaviorSubject<ColorPaletteConfig | null>(null);
  public palette$: Observable<ColorPaletteConfig | null> = this.paletteSubject.asObservable();

  constructor(
    private metadataService: MetadataService,
    private projectService: ProjectService,
    private themeService: ThemeService
  ) {
    // Subscribe to project changes
    this.projectService.currentProject$.subscribe(project => {
      if (project) {
        this.loadPalette();
      } else {
        this.paletteSubject.next(null);
      }
    });

    // Subscribe to theme changes to reload palette with theme defaults
    this.themeService.currentTheme$.subscribe(() => {
      // Only reload if no custom palette exists
      const settings = this.metadataService.getSettings();
      if (!settings?.colorPalette) {
        this.loadPalette();
      }
    });
  }

  /**
   * Load palette from project settings
   */
  private loadPalette(): void {
    const settings = this.metadataService.getSettings();
    const config = settings?.colorPalette;
    
    if (config) {
      this.paletteSubject.next(config);
    } else {
      // Use theme-specific default palette
      const currentTheme = this.themeService.getCurrentTheme();
      const themeColors = currentTheme?.colorPalette || DEFAULT_BASE_COLORS;
      
      const defaultConfig: ColorPaletteConfig = {
        baseColors: [...themeColors],
        extraColors: []
      };
      this.paletteSubject.next(defaultConfig);
    }
  }

  /**
   * Get current palette configuration
   */
  getCurrentPalette(): ColorPaletteConfig | null {
    return this.paletteSubject.value;
  }

  /**
   * Get all available colors (base + extra)
   */
  getAllColors(): string[] {
    const palette = this.getCurrentPalette();
    if (!palette) {
      const currentTheme = this.themeService.getCurrentTheme();
      return currentTheme?.colorPalette || [...DEFAULT_BASE_COLORS];
    }

    // Check if current theme has overrides
    const currentTheme = this.themeService.getCurrentTheme();
    if (currentTheme && palette.themeOverrides?.[currentTheme.id]) {
      return [...palette.themeOverrides[currentTheme.id], ...palette.extraColors];
    }

    return [...palette.baseColors, ...palette.extraColors];
  }

  /**
   * Get base colors (with theme overrides if applicable)
   */
  getBaseColors(): string[] {
    const palette = this.getCurrentPalette();
    if (!palette) {
      const currentTheme = this.themeService.getCurrentTheme();
      return currentTheme?.colorPalette || [...DEFAULT_BASE_COLORS];
    }

    const currentTheme = this.themeService.getCurrentTheme();
    if (currentTheme && palette.themeOverrides?.[currentTheme.id]) {
      return palette.themeOverrides[currentTheme.id];
    }

    return [...palette.baseColors];
  }

  /**
   * Get extra colors
   */
  getExtraColors(): string[] {
    const palette = this.getCurrentPalette();
    return palette?.extraColors || [];
  }

  /**
   * Update base color at index (for theming)
   */
  async updateBaseColor(index: number, color: string): Promise<void> {
    if (index < 0 || index >= 10) {
      throw new Error('Base color index must be between 0 and 9');
    }

    const palette = this.getCurrentPalette();
    if (!palette) {
      throw new Error('No palette loaded');
    }

    const newBaseColors = [...palette.baseColors];
    newBaseColors[index] = color;

    await this.savePalette({
      ...palette,
      baseColors: newBaseColors
    });
  }

  /**
   * Set theme-specific color overrides
   */
  async setThemeOverrides(themeId: string, colors: string[]): Promise<void> {
    if (colors.length !== 10) {
      throw new Error('Theme overrides must have exactly 10 colors');
    }

    const palette = this.getCurrentPalette();
    if (!palette) {
      throw new Error('No palette loaded');
    }

    const themeOverrides = {
      ...palette.themeOverrides,
      [themeId]: colors
    };

    await this.savePalette({
      ...palette,
      themeOverrides
    });
  }

  /**
   * Remove theme-specific color overrides
   */
  async removeThemeOverrides(themeId: string): Promise<void> {
    const palette = this.getCurrentPalette();
    if (!palette || !palette.themeOverrides) {
      return;
    }

    const themeOverrides = { ...palette.themeOverrides };
    delete themeOverrides[themeId];

    await this.savePalette({
      ...palette,
      themeOverrides: Object.keys(themeOverrides).length > 0 ? themeOverrides : undefined
    });
  }

  /**
   * Add an extra color
   */
  async addExtraColor(color: string): Promise<void> {
    const palette = this.getCurrentPalette();
    if (!palette) {
      throw new Error('No palette loaded');
    }

    if (palette.extraColors.includes(color)) {
      throw new Error('Color already exists in extra colors');
    }

    await this.savePalette({
      ...palette,
      extraColors: [...palette.extraColors, color]
    });
  }

  /**
   * Remove an extra color
   */
  async removeExtraColor(color: string): Promise<void> {
    const palette = this.getCurrentPalette();
    if (!palette) {
      throw new Error('No palette loaded');
    }

    await this.savePalette({
      ...palette,
      extraColors: palette.extraColors.filter(c => c !== color)
    });
  }

  /**
   * Reset base colors to theme defaults
   */
  async resetBaseColors(): Promise<void> {
    const palette = this.getCurrentPalette();
    if (!palette) {
      throw new Error('No palette loaded');
    }

    const currentTheme = this.themeService.getCurrentTheme();
    const themeColors = currentTheme?.colorPalette || DEFAULT_BASE_COLORS;

    await this.savePalette({
      ...palette,
      baseColors: [...themeColors]
    });
  }

  /**
   * Save palette configuration
   */
  private async savePalette(config: ColorPaletteConfig): Promise<void> {
    const settings = this.metadataService.getSettings();
    if (!settings) {
      throw new Error('No settings available');
    }

    await this.metadataService.updateSettings({
      ...settings,
      colorPalette: config
    });

    this.paletteSubject.next(config);
  }
}

