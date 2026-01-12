import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Theme } from '../interfaces/theme.interface';
import { themes, getThemeById, getDefaultTheme } from '../themes';
import { MetadataService } from './metadata.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private currentThemeSubject = new BehaviorSubject<Theme | null>(null);
  public currentTheme$: Observable<Theme | null> = this.currentThemeSubject.asObservable();

  private currentProjectPath: string | null = null;

  constructor(
    private metadataService: MetadataService,
    private projectService: ProjectService
  ) {
    // Subscribe to project changes to reload theme
    this.projectService.currentProject$.subscribe(project => {
      if (project) {
        // Only re-initialize if project path changed
        if (project.path !== this.currentProjectPath) {
          this.currentProjectPath = project.path;
          this.initialize();
        }
      } else {
        // No project loaded, apply default theme
        this.currentProjectPath = null;
        this.applyTheme(getDefaultTheme());
      }
    });
  }

  /**
   * Initialize theme from project settings
   */
  initialize(): void {
    const settings = this.metadataService.getSettings();
    const themeId = settings?.theme || 'blue-gold';
    
    const theme = getThemeById(themeId) || getDefaultTheme();
    this.applyTheme(theme);
  }

  /**
   * Get all available themes
   */
  getAvailableThemes(): Theme[] {
    return [...themes];
  }

  /**
   * Get current theme
   */
  getCurrentTheme(): Theme | null {
    return this.currentThemeSubject.value;
  }

  /**
   * Set theme by ID
   */
  async setTheme(themeId: string): Promise<void> {
    const theme = getThemeById(themeId);
    if (!theme) {
      throw new Error(`Theme not found: ${themeId}`);
    }

    // Apply theme immediately
    this.applyTheme(theme);

    // Save to project settings
    try {
      await this.metadataService.updateSettings({ theme: themeId });
    } catch (error) {
      console.error('Failed to save theme preference:', error);
      // Theme is still applied, just not saved
    }
  }

  /**
   * Apply theme to document root
   */
  private applyTheme(theme: Theme): void {
    const root = document.documentElement;
    const colors = theme.colors;

    // Apply background colors
    root.style.setProperty('--color-bg-primary', colors.bgPrimary);
    root.style.setProperty('--color-bg-secondary', colors.bgSecondary);
    root.style.setProperty('--color-bg-tertiary', colors.bgTertiary);
    root.style.setProperty('--color-bg-elevated', colors.bgElevated);
    root.style.setProperty('--color-bg-hover', colors.bgHover);

    // Apply accent colors
    root.style.setProperty('--color-accent-primary', colors.accentPrimary);
    root.style.setProperty('--color-accent-secondary', colors.accentSecondary);
    root.style.setProperty('--color-accent-dark', colors.accentDark);
    root.style.setProperty('--color-accent-muted', colors.accentMuted);
    root.style.setProperty('--color-accent-subtle', colors.accentSubtle);

    // Apply text colors
    root.style.setProperty('--color-text-primary', colors.textPrimary);
    root.style.setProperty('--color-text-secondary', colors.textSecondary);
    root.style.setProperty('--color-text-muted', colors.textMuted);
    root.style.setProperty('--color-text-inverse', colors.textInverse);

    // Apply border colors
    root.style.setProperty('--color-border', colors.border);
    root.style.setProperty('--color-border-light', colors.borderLight);
    root.style.setProperty('--color-border-subtle', colors.borderSubtle);

    // Apply status colors
    root.style.setProperty('--color-success', colors.success);
    root.style.setProperty('--color-warning', colors.warning);
    root.style.setProperty('--color-error', colors.error);
    root.style.setProperty('--color-info', colors.info);

    // Apply shadows
    root.style.setProperty('--shadow-sm', colors.shadowSm);
    root.style.setProperty('--shadow-md', colors.shadowMd);
    root.style.setProperty('--shadow-lg', colors.shadowLg);
    root.style.setProperty('--shadow-xl', colors.shadowXl);
    root.style.setProperty('--shadow-glow', colors.shadowGlow);
    root.style.setProperty('--shadow-card', colors.shadowCard);

    // Update current theme subject
    this.currentThemeSubject.next(theme);
  }
}

