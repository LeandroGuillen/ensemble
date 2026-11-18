import { ProjectReadOnlyDirective } from '../project-read-only.directive';
import { Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, NavigationEnd } from '@angular/router';

import { ProjectIconService, ProjectService } from '../../core/services';
import { BOOK_DRAG_TYPE, PinnedBookProgress, PinnedBooksService } from '../../core/services/pinned-books.service';
import { Book } from '../../core/interfaces/project.interface';
import { getBookDisplayName, getBookSpineLabel, getBookTitle } from '../../core/utils/book-display.utils';
import { ElectronService } from '../../core/services/electron.service';
import { UpdateService, UpdateStatus } from '../../core/services/update.service';
import { NotificationService } from '../../core/services/notification.service';
import { CharacterEditDialogService } from '../../core/services/character-edit-dialog.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';
import { ThemeService } from '../../core/services/theme.service';
import { Theme } from '../../core/interfaces/theme.interface';
import { SkinService } from '../../core/services/skin.service';
import { Skin } from '../../core/interfaces/skin.interface';
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
    imports: [ProjectReadOnlyDirective, ],
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectIconService = inject(ProjectIconService);
  private readonly pinnedBooks = inject(PinnedBooksService);
  /** First pinned book: shown as the card just above the Story section. */
  currentBook: Book | null = null;
  /** Remaining pinned books, shown as chips on the card. */
  otherBooks: Book[] = [];
  bookProgress: PinnedBookProgress | null = null;
  /** A book is being dragged from the Books page: the pin area becomes a drop target. */
  bookDragActive = false;
  /** The dragged book is over the pin area. */
  bookDropHover = false;
  private projectReadOnly = false;
  currentProjectName = '';
  /** Custom project icon (data URL); null shows the Ensemble logo. */
  projectIconUrl: string | null = null;
  currentRoute = '';
  private routeBeforeSettings = '/characters';
  /** Window width from which the labelled sidebar is shown by default. */
  static readonly AUTO_EXPAND_MIN_WIDTH = 1280;
  /** Below this width the sidebar folds to icons so content keeps its room;
   *  expanding it there opens the labels over the content instead of pushing it. */
  static readonly AUTO_COLLAPSE_MAX_WIDTH = 1100;
  /** True while the window is narrower than AUTO_COLLAPSE_MAX_WIDTH. */
  narrowWindow = false;
  /** Labels shown over the content in a narrow window (temporary, never saved). */
  overlayOpen = false;
  /** Explicit user choice from the toggle; null = follow the window width. */
  private savedCollapsed: boolean | null = null;
  isCollapsed = true;
  appVersion = '';
  updateStatus: UpdateStatus = { status: 'idle' };
  updateActionPending = false;
  themes: Theme[] = [];
  currentThemeId = '';
  skins: Skin[] = [];
  currentSkinId = '';
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
        { icon: 'sparkles', label: 'Prompts', route: '/prompts', title: 'Prompts' }
      ]
    },
    {
      id: 'world',
      label: 'World',
      items: [
        { icon: 'shield', label: 'Houses', route: '/houses', title: 'Houses' },
        { icon: 'map', label: 'Map', route: '/locations', title: 'Map' },
        { icon: 'timeline', label: 'Timeline', route: '/timeline', title: 'Timeline' }
      ]
    },
    {
      id: 'story',
      label: 'Story',
      items: [
        { icon: 'book', label: 'Books', route: '/library', title: 'Books' },
        { icon: 'theater', label: 'Casts', route: '/casts', title: 'Casts' },
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
    private themeService: ThemeService,
    private skinService: SkinService
  ) {}

  ngOnInit(): void {
    this.currentRoute = this.router.url;
    void this.loadAppVersion();
    this.themes = this.themeService.getAvailableThemes();
    this.themeService.currentTheme$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(theme => this.currentThemeId = theme?.id ?? '');
    this.skins = this.skinService.getAvailableSkins();
    this.skinService.currentSkin$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(skin => this.currentSkinId = skin.id);
    this.updateService.updateStatus$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => { this.updateStatus = status; });

    this.projectIconService.iconUrl$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(url => this.projectIconUrl = url);

    this.pinnedBooks.pinned$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(books => {
        this.currentBook = books[0] ?? null;
        this.otherBooks = books.slice(1);
      });
    this.pinnedBooks.draggingBookId$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(id => {
        this.bookDragActive = id !== null && !this.projectReadOnly;
        if (!this.bookDragActive) this.bookDropHover = false;
      });
    this.pinnedBooks.progress$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(progress => this.bookProgress = progress);

    this.projectService.currentProject$.subscribe((project: any) => {
      const folderName = typeof project?.path === 'string'
        ? project.path.split(/[\\/]/).filter(Boolean).pop() || ''
        : '';
      this.projectReadOnly = !!project?.readOnly;
      this.currentProjectName = project?.metadata?.projectName || project?.name || folderName;
    });

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        if (this.isSettingsRoute(event.urlAfterRedirects) && !this.isSettingsRoute(this.currentRoute)) {
          this.routeBeforeSettings = this.currentRoute || '/characters';
        }
        this.currentRoute = event.urlAfterRedirects;
        // A temporary overlay closes once the user has picked a destination.
        this.overlayOpen = false;
        this.applyLayout();
      });

    this.savedCollapsed = this.readSavedPreference();
    this.applyLayout();
  }

  private async loadAppVersion(): Promise<void> {
    try {
      this.appVersion = await this.electronService.getVersion();
    } catch (error) {
      console.warn('Failed to get app version:', error);
    }
  }

  /** Detail and create routes belong to the collection the user came from. */
  private static readonly SECTION_PREFIXES: Record<string, string[]> = {
    '/characters': ['/characters', '/character/', '/character?', '/character-draft'],
    '/library': ['/library', '/book/'],
    '/houses': ['/houses', '/house/', '/house?'],
    '/locations': ['/locations', '/location/', '/location?', '/world-map'],
    '/casts': ['/casts', '/cast/'],
  };

  isActive(route: string): boolean {
    const url = this.currentRoute;
    const prefixes = SidebarComponent.SECTION_PREFIXES[route] ?? [route];
    const exactCreate = route.replace(/s$/, '');
    return prefixes.some(prefix => url.startsWith(prefix)) || (exactCreate !== route && url === exactCreate);
  }

  /** `page` on the collection itself, `location` while inside one of its pages. */
  ariaCurrent(route: string): 'page' | 'location' | null {
    if (!this.isActive(route)) return null;
    const path = this.currentRoute.split(/[?#]/)[0];
    return path === route ? 'page' : 'location';
  }

  /** Tooltip / name that says where you are inside a section. */
  itemTitle(item: NavItem): string {
    if (item.route && this.ariaCurrent(item.route) === 'location') {
      return `${item.title} (back to the list)`;
    }
    return item.title;
  }

  private static readonly BOOK_STATUS_LABELS: Record<string, string> = {
    draft: 'Draft',
    'in-progress': 'In progress',
    published: 'Published',
    archived: 'Archived',
  };

  bookName(book: Book): string {
    return getBookDisplayName(book);
  }

  /** The title; a book identified only by its code shows the code. */
  bookTitle(book: Book): string {
    const title = getBookTitle(book);
    return title === 'Untitled' ? getBookSpineLabel(book) : title;
  }

  /** At most four characters fit the rail tile. */
  bookTileLabel(book: Book): string {
    return getBookSpineLabel(book).slice(0, 4);
  }

  /** Code, or a short form of the name, for the rail tile and the chips. */
  bookShortLabel(book: Book): string {
    return getBookSpineLabel(book);
  }

  /** "sr2 · In progress": whichever of code and status the book has. */
  bookMeta(book: Book): string {
    const status = book.status ? SidebarComponent.BOOK_STATUS_LABELS[book.status] ?? book.status : '';
    return [book.code?.trim(), status].filter(Boolean).join(' · ');
  }

  get progressLabel(): string | null {
    const progress = this.bookProgress;
    if (!progress || progress.total === 0) return null;
    if (progress.drafted === null) {
      return progress.total === 1 ? '1 chapter' : `${progress.total} chapters`;
    }
    return `${progress.drafted} of ${progress.total} drafted`;
  }

  /** Drafted share of the plan's chapters; null when there is nothing to measure. */
  get progressPercent(): number | null {
    const progress = this.bookProgress;
    if (!progress || progress.drafted === null || progress.total === 0) return null;
    return Math.round((progress.drafted / progress.total) * 100);
  }

  isBookOpen(book: Book): boolean {
    return this.currentRoute.split(/[?#]/)[0] === `/book/${book.id}`;
  }

  openBook(book: Book, view?: 'timeline'): void {
    void this.router.navigate(['/book', book.id], view ? { queryParams: { view } } : {});
  }

  /** Opens another pinned book and makes it the card's book. */
  switchBook(book: Book): void {
    this.openBook(book);
    // A read-only project still opens the book; it just keeps its card.
    this.pinnedBooks.makeCurrent(book.id).catch(() => undefined);
  }

  /** Shown while dragging a book: the card, or an empty lit area to drop on. */
  get showBookSection(): boolean {
    return !!this.currentBook || this.bookDragActive;
  }

  onBookDragOver(event: DragEvent): void {
    if (!this.bookDragActive) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.bookDropHover = true;
  }

  onBookDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (target && next && target.contains(next)) return;
    this.bookDropHover = false;
  }

  /** Dropping a book from the Books page pins it as the current book. */
  onBookDrop(event: DragEvent): void {
    if (!this.bookDragActive) return;
    event.preventDefault();
    this.bookDropHover = false;
    const bookId = this.pinnedBooks.draggingBookId || event.dataTransfer?.getData(BOOK_DRAG_TYPE) || '';
    if (!bookId) return;
    this.pinnedBooks.pin(bookId).catch((error: unknown) => {
      this.notificationService.showError(
        `Could not pin the book: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  unpinBook(book: Book): void {
    this.pinnedBooks.unpin(book.id).catch((error: unknown) => {
      this.notificationService.showError(
        `Could not unpin the book: ${error instanceof Error ? error.message : String(error)}`
      );
    });
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

  /** Back from another editor: chapters may have been written meanwhile. */
  @HostListener('window:focus')
  onWindowFocus(): void {
    if (this.currentBook) this.pinnedBooks.refresh();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.closeThemeMenu();
    this.applyLayout();
  }

  /**
   * Re-derives the sidebar state from the window width and the saved choice.
   * Runs at start-up and on every resize, so a window that grows past the
   * threshold gains labels (and loses them again) without a reload, while an
   * explicit choice from the toggle always wins in windows that have room.
   */
  private applyLayout(): void {
    const width = typeof window !== 'undefined' ? window.innerWidth : SidebarComponent.AUTO_EXPAND_MIN_WIDTH;
    this.narrowWindow = width < SidebarComponent.AUTO_COLLAPSE_MAX_WIDTH;
    if (this.narrowWindow) {
      this.isCollapsed = !this.overlayOpen;
      return;
    }
    this.overlayOpen = false;
    this.isCollapsed = this.savedCollapsed !== null
      ? this.savedCollapsed
      : width < SidebarComponent.AUTO_EXPAND_MIN_WIDTH;
  }

  private readSavedPreference(): boolean | null {
    try {
      const saved = localStorage.getItem('sidebar-collapsed');
      return saved === null ? null : saved === 'true';
    } catch {
      return null;
    }
  }

  get isOverlay(): boolean {
    return this.narrowWindow && this.overlayOpen;
  }

  get toggleLabel(): string {
    if (this.isOverlay) return 'Close sidebar';
    return this.isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
  }

  closeOverlay(): void {
    if (!this.overlayOpen) return;
    this.overlayOpen = false;
    this.applyLayout();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.themeMenuOpen) {
      event.preventDefault();
      this.closeThemeMenu();
      return;
    }
    if (event.key === 'Escape' && this.isOverlay && !event.defaultPrevented) {
      event.preventDefault();
      this.closeOverlay();
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
    if (this.narrowWindow) {
      // Narrow window: peek at the labels over the content; nothing is saved.
      this.overlayOpen = !this.overlayOpen;
      this.applyLayout();
      return;
    }
    this.savedCollapsed = !this.isCollapsed;
    try {
      localStorage.setItem('sidebar-collapsed', String(this.savedCollapsed));
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
    this.applyLayout();
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

  async selectSkin(skinId: string): Promise<void> {
    this.closeThemeMenu();
    if (skinId === this.currentSkinId) {
      return;
    }
    try {
      await this.skinService.setSkin(skinId);
    } catch (error) {
      this.notificationService.showError('Failed to switch skin');
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
    const version = this.updateVersionLabel;
    switch (this.updateStatus.status) {
      case 'available': return version ? `Download update ${version}` : 'Download update';
      case 'downloading': return `Downloading update ${this.updateDownloadPercent}%`;
      case 'downloaded': return version ? `Restart to apply update ${version}` : 'Restart to apply update';
      case 'checking': return 'Checking for updates';
      case 'error': return 'Update failed. Click to check again';
      default: return 'Up to date. Check for updates';
    }
  }

  get updateIconHref(): string {
    switch (this.updateStatus.status) {
      case 'checking': return '#icon-hourglass';
      case 'available':
      case 'downloading': return '#icon-download';
      case 'downloaded': return '#icon-power';
      case 'error': return '#icon-alert-triangle';
      default: return '#icon-circle-check';
    }
  }

  get updateAriaBusy(): 'true' | null {
    return this.updateStatus.status === 'checking' || this.updateStatus.status === 'downloading' ? 'true' : null;
  }

  get updateDownloadPercent(): number {
    const percent = this.updateStatus.progress?.percent ?? 0;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  private get updateVersionLabel(): string {
    const version = this.updateStatus.version?.trim();
    if (!version) return '';
    return version.toLowerCase().startsWith('v') ? version : `v${version}`;
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
