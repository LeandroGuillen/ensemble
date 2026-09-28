import { Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, NavigationEnd } from '@angular/router';

import { ProjectService } from '../../core/services';
import { ElectronService } from '../../core/services/electron.service';
import { UpdateService, UpdateStatus } from '../../core/services/update.service';
import { NotificationService } from '../../core/services/notification.service';
import { CharacterEditDialogService } from '../../core/services/character-edit-dialog.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';
import { ThemeService } from '../../core/services/theme.service';
import { Theme } from '../../core/interfaces/theme.interface';
import { KeyboardShortcutsService } from '../keyboard-shortcuts-dialog/keyboard-shortcuts.service';
import { filter } from 'rxjs/operators';

interface NavItem {
  icon: string;
  label: string;
  route?: string;
  title: string;
  action?: () => void;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

@Component({
    selector: 'app-sidebar',
    imports: [],
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  currentProjectName = '';
  currentRoute = '';
  private routeBeforeSettings = '/characters';
  isCollapsed = true;
  appVersion = '';
  updateStatus: UpdateStatus = { status: 'idle' };
  updateActionPending = false;
  themes: Theme[] = [];
  currentThemeId = '';
  themeMenuOpen = false;
  @ViewChild('themeMenu') private themeMenu?: ElementRef<HTMLElement>;
  themeMenuPosition = { left: 0, bottom: 0 };

  sections: NavSection[] = [
    {
      id: 'characters',
      label: 'Characters',
      items: [
        { icon: 'users', label: 'Characters', route: '/characters', title: 'Characters' },
        { icon: 'lightbulb', label: 'Concepts', route: '/concepts', title: 'Concepts' },
        { icon: 'type', label: 'Names', route: '/names', title: 'Names' },
        { icon: 'git-branch', label: 'Pinboard', route: '/pinboard', title: 'Pinboard' },
        { icon: 'theater', label: 'Casts', route: '/casts', title: 'Casts' }
      ]
    },
    {
      id: 'references',
      label: 'References',
      items: [
        { icon: 'book', label: 'Books', route: '/library', title: 'Books' },
        { icon: 'map-pin', label: 'Locations', route: '/locations', title: 'Locations' },
        { icon: 'plot-board', label: 'Plot Board', route: '/plot-board', title: 'Plot Board' }
      ]
    }
  ];

  constructor(
    private projectService: ProjectService,
    private electronService: ElectronService,
    private router: Router,
    private shortcutsService: KeyboardShortcutsService,
    private commandPaletteService: CommandPaletteService,
    private characterEditDialog: CharacterEditDialogService,
    private updateService: UpdateService,
    private notificationService: NotificationService,
    private themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.currentRoute = this.router.url;
    void this.loadAppVersion();
    this.themes = this.themeService.getAvailableThemes();
    this.themeService.currentTheme$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(theme => this.currentThemeId = theme?.id ?? '');
    this.updateService.updateStatus$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => { this.updateStatus = status; });

    this.projectService.currentProject$.subscribe((project: any) => {
      this.currentProjectName = project?.name || '';
    });

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        if (this.isSettingsRoute(event.urlAfterRedirects) && !this.isSettingsRoute(this.currentRoute)) {
          this.routeBeforeSettings = this.currentRoute || '/characters';
        }
        this.currentRoute = event.urlAfterRedirects;
      });

    // Load saved collapse state
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) {
      this.isCollapsed = saved === 'true';
    }

  }

  private async loadAppVersion(): Promise<void> {
    try {
      this.appVersion = await this.electronService.getVersion();
    } catch (error) {
      console.warn('Failed to get app version:', error);
    }
  }

  isActive(route: string): boolean {
    return this.currentRoute.startsWith(route);
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  get isInSettings(): boolean {
    return this.isSettingsRoute(this.currentRoute);
  }

  backFromSettings(): void {
    void this.router.navigateByUrl(this.routeBeforeSettings);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeThemeMenu();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.closeThemeMenu();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.themeMenuOpen) {
      event.preventDefault();
      this.closeThemeMenu();
      return;
    }
    if (event.key !== 'Escape' || !this.isInSettings || event.defaultPrevented ||
        document.querySelector('.modal-overlay, .command-palette-backdrop, .shortcuts-backdrop')) {
      return;
    }
    event.preventDefault();
    this.backFromSettings();
  }

  private isSettingsRoute(url: string): boolean {
    return url === '/settings' || url.startsWith('/settings?') || url.startsWith('/settings#');
  }

  handleItemClick(item: NavItem): void {
    if (item.action) {
      item.action();
    } else if (item.route) {
      this.navigateTo(item.route);
    }
  }

  selectProject(): void {
    this.router.navigate(['/project-selector']);
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    localStorage.setItem('sidebar-collapsed', String(this.isCollapsed));
  }

  toggleThemeMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (this.themeMenuOpen) {
      this.closeThemeMenu();
      return;
    }
    // Position next to the button: above it when expanded, to its right when collapsed.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.themeMenuPosition = this.isCollapsed
      ? { left: rect.right + 8, bottom: window.innerHeight - rect.bottom }
      : { left: rect.left, bottom: window.innerHeight - rect.top + 6 };
    this.themeMenuOpen = true;
    this.themeMenu?.nativeElement.showPopover();
  }

  private closeThemeMenu(): void {
    if (!this.themeMenuOpen) {
      return;
    }
    this.themeMenuOpen = false;
    this.themeMenu?.nativeElement.hidePopover();
  }

  async selectTheme(themeId: string): Promise<void> {
    this.closeThemeMenu();
    if (themeId === this.currentThemeId) {
      return;
    }
    try {
      await this.themeService.setTheme(themeId);
    } catch (error) {
      this.notificationService.showError('Failed to switch theme');
    }
  }

  openShortcuts(): void {
    this.shortcutsService.open();
  }

  openSearch(): void {
    this.commandPaletteService.open();
  }

  openNewDraft(): void {
    this.characterEditDialog.openCreateDraft();
  }

  get updateActionLabel(): string {
    switch (this.updateStatus.status) {
      case 'available': return `Download update${this.updateStatus.version ? ` ${this.updateStatus.version}` : ''}`;
      case 'downloading': return `Downloading update${this.updateStatus.progress ? ` ${Math.round(this.updateStatus.progress.percent)}%` : ''}`;
      case 'downloaded': return 'Restart to apply update';
      case 'checking': return 'Checking for updates';
      case 'error': return 'Check for updates again';
      default: return 'Check for updates';
    }
  }

  get updateActionDisabled(): boolean {
    return this.updateActionPending || this.updateStatus.status === 'checking' || this.updateStatus.status === 'downloading';
  }

  async handleUpdateAction(): Promise<void> {
    if (this.updateActionDisabled) return;
    this.updateActionPending = true;
    try {
      const result = this.updateStatus.status === 'downloaded'
        ? await this.updateService.quitAndInstall()
        : this.updateStatus.status === 'available'
          ? await this.updateService.downloadUpdate()
          : await this.updateService.checkForUpdates();
      if (!result.success) {
        this.notificationService.showError(result.error || 'Update failed');
      }
    } finally {
      this.updateActionPending = false;
    }
  }
}
