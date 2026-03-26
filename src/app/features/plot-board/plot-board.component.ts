import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Injector,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { ActivatedRoute, Router, RouterLink, UrlSegment } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { PlotBoardService } from '../../core/services/plot-board.service';
import { CharacterService } from '../../core/services/character.service';
import { CharacterPickerService } from '../../core/services/character-picker.service';
import { ProjectService } from '../../core/services/project.service';
import { LoggingService } from '../../core/services/logging.service';
import { ColorPaletteService } from '../../core/services/color-palette.service';
import { PlotBoard, PlotCellMeta, PlotRow, PlotThread } from '../../core/interfaces/plot-board.interface';
import { Character } from '../../core/interfaces/character.interface';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { pathBasename } from '../../core/utils/path.utils';

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Story', emojis: ['⚔️', '🛡️', '💀', '👑', '🏰', '🗡️', '🔮', '📜', '🏴', '🎭'] },
  { label: 'Emotion', emojis: ['❤️', '💔', '😢', '😠', '😱', '🤝', '💤', '🔥', '✨', '💫'] },
  { label: 'Nature', emojis: ['🌙', '☀️', '⛈️', '🌊', '🏔️', '🌲', '🐉', '🐺', '🦅', '🕷️'] },
  { label: 'Objects', emojis: ['💎', '🗝️', '📖', '🏹', '⚓', '🔔', '🕯️', '💰', '🧪', '⏳'] },
  { label: 'Symbols', emojis: ['⭐', '🔴', '🟢', '🔵', '⚫', '⬛', '🔺', '💠', '🎯', '🚩'] },
];

export type ZoomLevel = 1 | 2 | 3;

@Component({
  selector: 'app-plot-board',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './plot-board.component.html',
  styleUrls: ['./plot-board.component.scss'],
  animations: [
    trigger('plotBoardContent', [
      transition('* => *', [
        style({ opacity: 0 }),
        animate('260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)', style({ opacity: 1 })),
      ]),
    ]),
    trigger('plotBoardSidebar', [
      state(
        'open',
        style({
          width: '240px',
        })
      ),
      state(
        'closed',
        style({
          width: '0',
          overflow: 'hidden',
        })
      ),
      transition('open <=> closed', [
        animate('240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'),
      ]),
    ]),
  ],
})
export class PlotBoardComponent implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();
  private saveRequest$ = new Subject<void>();

  board: PlotBoard = { threads: [], rows: [], cells: {}, cellMeta: {} };
  characters: Character[] = [];
  isLoading = false;
  /** Drives fade animation after a board finishes loading (avoids animating stale data) */
  displayedBoardPath: string | null = null;
  zoomLevel: ZoomLevel = 3;

  editingCell: { row: number; threadId: string } | null = null;
  editingRowName: number | null = null;
  editingThreadName: string | null = null;
  editingCellValue = '';
  editingCellIcon = '';
  editingCellColor = '';
  editingNameValue = '';
  showEmojiPicker = false;
  /** Modifier shown in cell editor Save hint (⌘ on Apple platforms, Ctrl elsewhere). */
  cellSaveShortcutModifierLabel = 'Ctrl';

  // Icon/color pickers for thread headers and row labels
  showThreadIconPicker: string | null = null;
  showThreadColorPicker: string | null = null;
  showRowIconPicker: number | null = null;

  confirmRemoveCharacter: { threadId: string; characterId: string } | null = null;
  confirmDeleteThreadId: string | null = null;
  confirmDeleteRowIndex: number | null = null;
  confirmDeleteCell = false;

  dragSource:
    | { kind: 'cell'; row: number; threadId: string }
    | { kind: 'row'; fromIndex: number }
    | { kind: 'thread'; fromIndex: number }
    | null = null;
  dragOverTarget: { row: number; threadId: string } | null = null;
  /** Drop target index while reordering threads (column headers). */
  dragOverThreadIndex: number | null = null;
  /** Drop target index while reordering rows (row labels). */
  dragOverRowIndex: number | null = null;

  paletteColors: string[] = [];
  emojiGroups = EMOJI_GROUPS;

  thumbnailCache: Map<string, string> = new Map();

  /** Sorted project-relative paths to plot board files */
  plotboardPaths: string[] = [];
  renameError = '';
  showRenameDialog = false;
  renameValue = '';
  showNewPlotBoardDialog = false;
  newPlotBoardName = '';
  newPlotBoardError = '';
  showDeletePlotBoardDialog = false;
  deletePlotBoardError = '';
  /** Shown when duplicate fails (e.g. disk error) */
  duplicateError = '';
  /** File being renamed or deleted from the sidebar (when not the open file) */
  renameTargetPath: string | null = null;
  deleteTargetPath: string | null = null;
  private resolvingEmptyRoute = false;

  @ViewChild('boardContent') boardContent?: ElementRef<HTMLElement>;
  @ViewChild('cellEditTextarea') cellEditTextarea?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('threadNameInput') threadNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('rowNameInput') rowNameInput?: ElementRef<HTMLInputElement>;

  /** Viewport coords for fixed thread toolbars (escapes page-header stacking context). */
  threadToolbarFixedPos: Record<string, { top: number; left: number }> = {};
  /** Hovered row or toolbar; confirm-delete keeps toolbar without hover. */
  activeThreadToolbarRowId: string | null = null;
  private threadToolbarLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  private threadToolbarPointerInsideToolbar = false;
  private threadToolbarAnchorById = new Map<string, HTMLElement>();

  private static readonly THREAD_TOOLBAR_APPROX_HEIGHT = 36;
  private static readonly THREAD_TOOLBAR_GAP = 6;

  private static readonly CELL_EDIT_HINT = 'Double-click to edit · Drag to move';

  /** Max height for cell edit textarea (matches CSS max-height). */
  private static readonly CELL_EDIT_TEXTAREA_MAX_REM = 15;

  private static readonly PLOTBOARD_SIDEBAR_STORAGE_KEY = 'ensemble.plotBoard.sidebarOpen';

  /** Plot board file list panel (left column) */
  plotboardSidebarOpen = true;

  /** Keyboard grid cursor (arrow keys); not used while editingCell. */
  keyboardFocusCell: { row: number; threadId: string } | null = null;

  constructor(
    private plotBoardService: PlotBoardService,
    private characterService: CharacterService,
    private characterPickerService: CharacterPickerService,
    private projectService: ProjectService,
    private logger: LoggingService,
    private colorPaletteService: ColorPaletteService,
    private route: ActivatedRoute,
    private router: Router,
    private ngZone: NgZone,
    private injector: Injector
  ) {}

  private readonly onBoardContentScroll = (): void => {
    this.ngZone.run(() => this.refreshActiveThreadToolbarLayout());
  };

  ngOnInit(): void {
    try {
      const v = localStorage.getItem(PlotBoardComponent.PLOTBOARD_SIDEBAR_STORAGE_KEY);
      if (v === '0') this.plotboardSidebarOpen = false;
      else if (v === '1') this.plotboardSidebarOpen = true;
    } catch {
      /* ignore */
    }

    if (
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ) {
      this.cellSaveShortcutModifierLabel = '⌘';
    }

    this.saveRequest$
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe(() => this.persistBoard());

    this.characterService.characters$
      .pipe(takeUntil(this.destroy$))
      .subscribe((chars) => {
        this.characters = chars;
        this.refreshThumbnails();
      });

    this.colorPaletteService.palette$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.paletteColors = this.colorPaletteService.getAllColors();
      });

    this.route.url.pipe(takeUntil(this.destroy$)).subscribe((segments) => {
      void this.onRouteSegments(segments);
    });
  }

  ngAfterViewInit(): void {
    const el = this.boardContent?.nativeElement;
    if (el) {
      el.addEventListener('scroll', this.onBoardContentScroll, { passive: true });
    }
  }

  ngOnDestroy(): void {
    const el = this.boardContent?.nativeElement;
    if (el) {
      el.removeEventListener('scroll', this.onBoardContentScroll);
    }
    this.clearThreadToolbarLeaveTimer();
    // Save in-flight edits; prevents a remount (e.g. sidebar `/plot-board`) from flushing an empty `board` against a stale service path.
    void this.flushSaveIfNeeded();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private clearThreadToolbarLeaveTimer(): void {
    if (this.threadToolbarLeaveTimer) {
      clearTimeout(this.threadToolbarLeaveTimer);
      this.threadToolbarLeaveTimer = null;
    }
  }

  onThreadNameRowEnter(threadId: string, anchor: HTMLElement): void {
    if (
      this.showThreadColorPicker !== null &&
      this.showThreadColorPicker !== threadId
    ) {
      this.showThreadColorPicker = null;
    }
    this.clearThreadToolbarLeaveTimer();
    this.threadToolbarPointerInsideToolbar = false;
    this.activeThreadToolbarRowId = threadId;
    this.threadToolbarAnchorById.set(threadId, anchor);
    this.layoutThreadToolbar(threadId, anchor);
  }

  onThreadNameRowLeave(threadId: string): void {
    if (
      this.confirmDeleteThreadId === threadId ||
      this.showThreadColorPicker === threadId
    ) {
      return;
    }
    this.threadToolbarLeaveTimer = setTimeout(() => {
      if (
        !this.threadToolbarPointerInsideToolbar &&
        this.activeThreadToolbarRowId === threadId
      ) {
        this.activeThreadToolbarRowId = null;
        // Keep threadToolbarFixedPos until next hover — clearing top/left caused a one-frame
        // jump (static layout position) before opacity hid the bar.
        this.threadToolbarAnchorById.delete(threadId);
      }
      this.threadToolbarLeaveTimer = null;
    }, 200);
  }

  onThreadToolbarMouseEnter(threadId: string): void {
    if (
      this.showThreadColorPicker !== null &&
      this.showThreadColorPicker !== threadId
    ) {
      this.showThreadColorPicker = null;
    }
    this.clearThreadToolbarLeaveTimer();
    this.threadToolbarPointerInsideToolbar = true;
    this.activeThreadToolbarRowId = threadId;
    const anchor = this.threadToolbarAnchorById.get(threadId);
    if (anchor) {
      this.layoutThreadToolbar(threadId, anchor);
    }
  }

  onThreadToolbarMouseLeave(threadId: string): void {
    this.threadToolbarPointerInsideToolbar = false;
    if (
      this.confirmDeleteThreadId === threadId ||
      this.showThreadColorPicker === threadId
    ) {
      return;
    }
    this.onThreadNameRowLeave(threadId);
  }

  isThreadToolbarVisible(threadId: string): boolean {
    const visible =
      this.activeThreadToolbarRowId === threadId ||
      this.confirmDeleteThreadId === threadId ||
      this.showThreadColorPicker === threadId;
    return visible;
  }

  private layoutThreadToolbar(threadId: string, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const h = PlotBoardComponent.THREAD_TOOLBAR_APPROX_HEIGHT;
    const gap = PlotBoardComponent.THREAD_TOOLBAR_GAP;
    // Always above the icon+name row. Fixed + z-index stacks above the page header; do not move
    // below the row (that covered thumbnails).
    const top = rect.top - h - gap;
    const left = rect.left + rect.width / 2;
    this.threadToolbarFixedPos[threadId] = { top, left };
  }

  private refreshActiveThreadToolbarLayout(): void {
    const id =
      this.activeThreadToolbarRowId ??
      this.confirmDeleteThreadId ??
      this.showThreadColorPicker;
    if (!id) return;
    const anchor = this.threadToolbarAnchorById.get(id);
    if (!anchor) {
      // Anchor disappeared (e.g. rerender); nothing to reposition right now.
    }
    if (anchor) {
      this.layoutThreadToolbar(id, anchor);
    }
  }

  // These helpers prevent template crashes when the toolbar is visible
  // but its fixed position hasn't been computed yet.
  getThreadToolbarTop(threadId: string): number {
    const entry = this.threadToolbarFixedPos[threadId];
    const top = entry?.top;
    if (top === undefined) {
      return 0;
    }
    return top;
  }

  getThreadToolbarLeft(threadId: string): number {
    const entry = this.threadToolbarFixedPos[threadId];
    const left = entry?.left;
    if (left === undefined) {
      return 0;
    }
    return left;
  }

  @HostListener('window:resize')
  onWindowResizeForThreadToolbar(): void {
    this.refreshActiveThreadToolbarLayout();
  }

  get gridTemplateColumns(): string {
    const labelWidth =
      this.zoomLevel === 1 ? '104px' : this.zoomLevel === 2 ? '168px' : '224px';
    return `${labelWidth} repeat(${this.board.threads.length}, 1fr)`;
  }

  get zoomClass(): string {
    return `zoom-${this.zoomLevel}`;
  }

  setZoom(level: ZoomLevel): void {
    this.zoomLevel = level;
    this.projectService.savePlotBoardZoom(level);
  }

  get hasOpenFile(): boolean {
    return this.plotBoardService.getCurrentRelativePath() !== null;
  }

  /** Path shown in delete confirmation */
  get deleteDialogPath(): string | null {
    return this.deleteTargetPath;
  }

  get boardContentKey(): string {
    return this.displayedBoardPath ?? '__none__';
  }

  get pageTitle(): string {
    const p = this.plotBoardService.getCurrentRelativePath();
    if (!p) return 'Plot Board';
    return this.displayStem(p);
  }

  togglePlotboardSidebar(): void {
    this.plotboardSidebarOpen = !this.plotboardSidebarOpen;
    try {
      localStorage.setItem(
        PlotBoardComponent.PLOTBOARD_SIDEBAR_STORAGE_KEY,
        this.plotboardSidebarOpen ? '1' : '0'
      );
    } catch {
      /* ignore */
    }
  }

  displayStem(relativePath: string): string {
    const base = pathBasename(relativePath);
    return base
      .replace(/\.pinboard\.md$/i, '')
      .replace(/\.plotboard\.md$/i, '')
      .replace(/-/g, ' ');
  }

  pathSegmentsForRouter(relativePath: string): string[] {
    return relativePath.split('/').filter((s) => s.length > 0);
  }

  routerLinkForPlotboard(relativePath: string): string[] {
    return ['/plot-board', ...this.pathSegmentsForRouter(relativePath)];
  }

  isCurrentPath(relativePath: string): boolean {
    const cur = this.plotBoardService.getCurrentRelativePath();
    if (!cur) return false;
    return this.plotBoardService.normalizeRelativePath(cur) === this.plotBoardService.normalizeRelativePath(relativePath);
  }

  private async onRouteSegments(segments: UrlSegment[]): Promise<void> {
    this.isLoading = true;
    try {
      const savedZoom = this.projectService.getPlotBoardZoom();
      if (savedZoom && [1, 2, 3].includes(savedZoom)) {
        this.zoomLevel = savedZoom as ZoomLevel;
      }

      const path = segments.length === 0 ? null : segments.map((s) => s.path).join('/');

      if (path === null) {
        await this.flushSaveIfNeeded();
        await this.handleEmptyPlotBoardRoute();
      } else {
        await this.flushSaveIfNeeded();
        await this.plotBoardService.loadPlotBoard(path);
        const loaded = this.plotBoardService.getPlotBoard();
        if (loaded) {
          this.board = loaded;
        }
        await this.projectService.saveLastPlotboardPath(path);
      }

      const project = this.projectService.getCurrentProject();
      if (project?.path) {
        await this.characterService.loadCharacters(project.path);
      }
      await this.refreshPlotboardList();
      await this.refreshThumbnails();
    } catch (error) {
      this.logger.error('Failed to load plot board', error);
    } finally {
      this.displayedBoardPath = this.plotBoardService.getCurrentRelativePath();
      this.isLoading = false;
      this.keyboardFocusCell = null;
    }
  }

  private async handleEmptyPlotBoardRoute(): Promise<void> {
    if (this.resolvingEmptyRoute) return;
    this.resolvingEmptyRoute = true;
    try {
      await this.refreshPlotboardList();
      const last = this.projectService.getLastPlotboardPath();
      const norm = last ? this.plotBoardService.normalizeRelativePath(last) : null;
      const target =
        norm && this.plotboardPaths.includes(norm)
          ? norm
          : this.plotboardPaths[0] ?? null;
      if (target) {
        await this.router.navigate(['/plot-board', ...this.pathSegmentsForRouter(target)], {
          replaceUrl: true,
        });
      } else {
        await this.plotBoardService.loadPlotBoard(null);
        this.board = { threads: [], rows: [], cells: {}, cellMeta: {} };
      }
    } finally {
      this.resolvingEmptyRoute = false;
    }
  }

  async refreshPlotboardList(): Promise<void> {
    this.plotboardPaths = await this.plotBoardService.discoverPlotboardFiles();
  }

  async refreshPlotboards(): Promise<void> {
    await this.refreshPlotboardList();
  }

  openNewPlotBoardDialog(): void {
    this.newPlotBoardName = '';
    this.newPlotBoardError = '';
    this.showNewPlotBoardDialog = true;
  }

  cancelNewPlotBoard(): void {
    this.showNewPlotBoardDialog = false;
    this.newPlotBoardError = '';
  }

  async applyNewPlotBoard(): Promise<void> {
    const trimmed = this.newPlotBoardName.trim();
    if (!trimmed) {
      this.newPlotBoardError = 'Enter a name';
      return;
    }
    this.newPlotBoardError = '';
    await this.flushSaveIfNeeded();
    const result = await this.plotBoardService.createPlotBoardFile(trimmed);
    if (!result.success || !result.relativePath) {
      this.newPlotBoardError = result.error || 'Could not create plot board';
      return;
    }
    this.showNewPlotBoardDialog = false;
    await this.router.navigate(['/plot-board', ...this.pathSegmentsForRouter(result.relativePath)]);
    await this.refreshPlotboardList();
  }

  openDeletePlotBoardDialogForPath(rel: string): void {
    this.deleteTargetPath = this.plotBoardService.normalizeRelativePath(rel);
    this.deletePlotBoardError = '';
    this.showDeletePlotBoardDialog = true;
  }

  cancelDeletePlotBoard(): void {
    this.showDeletePlotBoardDialog = false;
    this.deletePlotBoardError = '';
    this.deleteTargetPath = null;
  }

  async confirmDeletePlotBoard(): Promise<void> {
    const p = this.deleteTargetPath;
    if (!p) return;
    const cur = this.plotBoardService.getCurrentRelativePath();
    const isDeletingOpen =
      !!cur && this.plotBoardService.normalizeRelativePath(p) === this.plotBoardService.normalizeRelativePath(cur);
    if (isDeletingOpen) {
      await this.flushSaveIfNeeded();
    }
    const del = await this.plotBoardService.deletePlotBoardFile(p);
    if (!del.success) {
      this.deletePlotBoardError = del.error || 'Could not delete file';
      return;
    }
    this.showDeletePlotBoardDialog = false;
    this.deleteTargetPath = null;
    await this.refreshPlotboardList();
    if (isDeletingOpen) {
      const next = this.plotboardPaths[0] ?? null;
      if (next) {
        await this.router.navigate(['/plot-board', ...this.pathSegmentsForRouter(next)]);
      } else {
        await this.router.navigate(['/plot-board'], { replaceUrl: true });
      }
    }
  }

  openRenameDialogForPath(rel: string): void {
    this.renameTargetPath = this.plotBoardService.normalizeRelativePath(rel);
    this.renameValue = pathBasename(rel)
      .replace(/\.pinboard\.md$/i, '')
      .replace(/\.plotboard\.md$/i, '')
      .replace(/-/g, ' ');
    this.renameError = '';
    this.showRenameDialog = true;
  }

  cancelRename(): void {
    this.showRenameDialog = false;
    this.renameError = '';
    this.renameTargetPath = null;
  }

  async applyRename(): Promise<void> {
    const target = this.renameTargetPath ?? this.plotBoardService.getCurrentRelativePath();
    if (!target) return;
    const current = this.plotBoardService.getCurrentRelativePath();
    const isRenamingOpen =
      !!current &&
      this.plotBoardService.normalizeRelativePath(target) === this.plotBoardService.normalizeRelativePath(current);
    if (isRenamingOpen) {
      await this.flushSaveIfNeeded();
    }
    const result = await this.plotBoardService.renamePlotBoardFile(target, this.renameValue);
    if (!result.success) {
      this.renameError = result.error || 'Rename failed';
      return;
    }
    this.renameError = '';
    this.showRenameDialog = false;
    this.renameTargetPath = null;
    await this.refreshPlotboardList();
    if (result.newRelative && isRenamingOpen) {
      await this.router.navigate(['/plot-board', ...this.pathSegmentsForRouter(result.newRelative)], {
        replaceUrl: true,
      });
      await this.projectService.saveLastPlotboardPath(result.newRelative);
    }
  }

  async duplicatePlotBoardForPath(rel: string): Promise<void> {
    this.duplicateError = '';
    const norm = this.plotBoardService.normalizeRelativePath(rel);
    const cur = this.plotBoardService.getCurrentRelativePath();
    const isDuplicatingOpen =
      !!cur && this.plotBoardService.normalizeRelativePath(cur) === norm;
    if (isDuplicatingOpen) {
      await this.flushSaveIfNeeded();
    }
    const result = await this.plotBoardService.duplicatePlotBoardFile(norm);
    if (!result.success || !result.newRelative) {
      this.duplicateError = result.error || 'Could not duplicate file';
      return;
    }
    await this.refreshPlotboardList();
    await this.router.navigate(['/plot-board', ...this.pathSegmentsForRouter(result.newRelative)]);
    await this.projectService.saveLastPlotboardPath(result.newRelative);
  }

  /** True when `board` was loaded for the file the service considers open (avoids saving default empty state or the wrong file mid-navigation). */
  private isBoardSyncedToOpenFile(): boolean {
    const path = this.plotBoardService.getCurrentRelativePath();
    if (!path || !this.displayedBoardPath) return false;
    const norm = (p: string) => this.plotBoardService.normalizeRelativePath(p);
    return norm(this.displayedBoardPath) === norm(path);
  }

  private async flushSaveIfNeeded(): Promise<void> {
    if (!this.isBoardSyncedToOpenFile()) return;
    try {
      await this.plotBoardService.savePlotBoard({ ...this.board });
    } catch (error) {
      this.logger.error('Failed to save plot board before switching', error);
    }
  }

  private queueSave(): void {
    this.saveRequest$.next();
  }

  private async persistBoard(): Promise<void> {
    if (!this.isBoardSyncedToOpenFile()) return;
    try {
      await this.plotBoardService.savePlotBoard({ ...this.board });
    } catch (error) {
      this.logger.error('Failed to save plot board', error);
    }
  }

  private async refreshThumbnails(): Promise<void> {
    const allCharIds = new Set<string>();
    for (const thread of this.board.threads) {
      for (const cid of thread.characters) {
        allCharIds.add(cid);
      }
    }

    for (const cid of allCharIds) {
      if (this.thumbnailCache.has(cid)) continue;
      const char = this.characters.find((c) => c.id === cid);
      if (!char) continue;
      const cached = this.characterService.getCachedThumbnail(cid);
      if (cached) {
        this.thumbnailCache.set(cid, cached);
      } else {
        const loaded = await this.characterService.loadThumbnailForCharacter(char);
        if (loaded) {
          this.thumbnailCache.set(cid, loaded);
        }
      }
    }
  }

  getCharacterThumbnail(characterId: string): string | null {
    return this.thumbnailCache.get(characterId) || null;
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (this.confirmDeleteThreadId !== null && !target.closest('.confirm-delete-btn, .btn-danger')) {
      this.confirmDeleteThreadId = null;
    }
    if (this.confirmDeleteRowIndex !== null && !target.closest('.confirm-delete-btn, .btn-danger')) {
      this.confirmDeleteRowIndex = null;
    }

    if (this.editingCell && !target.closest('.cell-edit-popover, .event-box, .empty-cell-target')) {
      this.finishEditCell();
    }
    if (this.editingRowName !== null && !target.closest('.row-label')) {
      this.finishEditRowName();
    }
    if (
      this.editingThreadName !== null &&
      !target.closest('.thread-header') &&
      !target.closest('.thread-hover-toolbar')
    ) {
      this.finishEditThreadName();
    }

    if (this.showThreadIconPicker !== null && !target.closest('.thread-icon-picker-area')) {
      this.showThreadIconPicker = null;
    }
    if (this.showThreadColorPicker !== null && !target.closest('.thread-color-picker-area')) {
      this.showThreadColorPicker = null;
    }
    if (this.showRowIconPicker !== null && !target.closest('.row-icon-picker-area')) {
      this.showRowIconPicker = null;
    }
    if (this.confirmRemoveCharacter !== null && !target.closest('.character-thumb')) {
      this.confirmRemoveCharacter = null;
    }
  }

  // --- Thread (column) management ---

  addThread(): void {
    const name = 'New Thread';
    const id = this.plotBoardService.generateThreadId(name, this.board.threads);
    this.board.threads = [...this.board.threads, { id, name, characters: [] }];
    this.queueSave();
  }

  requestDeleteThread(threadId: string): void {
    this.confirmDeleteThreadId = threadId;
  }

  confirmDeleteThread(threadId: string): void {
    this.confirmDeleteThreadId = null;
    this.removeThread(threadId);
  }

  private removeThread(threadId: string): void {
    this.board.threads = this.board.threads.filter((t) => t.id !== threadId);
    for (const rowKey of Object.keys(this.board.cells)) {
      delete this.board.cells[rowKey][threadId];
    }
    for (const rowKey of Object.keys(this.board.cellMeta)) {
      delete this.board.cellMeta[rowKey][threadId];
    }
    this.queueSave();
  }

  startEditThreadName(threadId: string): void {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;
    this.editingThreadName = threadId;
    this.editingNameValue = thread.name;
    this.focusNameInputAfterRender('thread');
  }

  finishEditThreadName(): void {
    if (this.editingThreadName === null) return;
    const thread = this.board.threads.find((t) => t.id === this.editingThreadName);
    if (thread) {
      const newName = this.editingNameValue.trim() || thread.name;
      if (newName !== thread.name) {
        const oldId = thread.id;
        const newId = this.plotBoardService.generateThreadId(newName, this.board.threads, oldId);
        thread.name = newName;
        thread.id = newId;
        this.plotBoardService.renameThreadId(this.board, oldId, newId);
      }
    }
    this.editingThreadName = null;
    this.queueSave();
  }

  // --- Thread icon ---

  toggleThreadIconPicker(threadId: string): void {
    this.showThreadIconPicker = this.showThreadIconPicker === threadId ? null : threadId;
  }

  selectThreadIcon(threadId: string, emoji: string): void {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.icon = thread.icon === emoji ? undefined : emoji;
    this.showThreadIconPicker = null;
    this.queueSave();
  }

  clearThreadIcon(threadId: string): void {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.icon = undefined;
    this.showThreadIconPicker = null;
    this.queueSave();
  }

  // --- Thread color ---

  toggleThreadColorPicker(threadId: string): void {
    if (this.showThreadColorPicker === threadId) {
      this.showThreadColorPicker = null;
      return;
    }
    this.showThreadColorPicker = threadId;
    this.activeThreadToolbarRowId = threadId;
    const anchor = this.threadToolbarAnchorById.get(threadId);
    if (anchor) {
      this.layoutThreadToolbar(threadId, anchor);
    }
  }

  selectThreadColor(threadId: string, color: string): void {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.color = thread.color === color ? undefined : color;
    this.showThreadColorPicker = null;
    this.queueSave();
  }

  clearThreadColor(threadId: string): void {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.color = undefined;
    this.showThreadColorPicker = null;
    this.queueSave();
  }

  getThreadColor(threadId: string): string | null {
    const thread = this.board.threads.find((t) => t.id === threadId);
    return thread?.color ?? null;
  }

  getBoxBorderColor(rowIndex: number, threadId: string): string | null {
    const cellColor = this.getCellMeta(rowIndex, threadId)?.color;
    if (cellColor) return cellColor;
    return this.getThreadColor(threadId);
  }

  // --- Row management ---

  /**
   * If `lastName` ends with digits, same prefix + incremented number (preserves simple leading zeros).
   * Otherwise `Row ${fallbackIndex}`.
   */
  private nextRowNameAfter(lastName: string, fallbackIndex: number): string {
    const trimmed = lastName.trim();
    const m = trimmed.match(/^(.*?)(\d+)$/);
    if (!m) {
      return `Row ${fallbackIndex}`;
    }
    const prefix = m[1];
    const numPart = m[2];
    const n = parseInt(numPart, 10) + 1;
    if (!Number.isFinite(n)) {
      return `Row ${fallbackIndex}`;
    }
    let numOut = String(n);
    if (numPart.length > 1 && numPart.startsWith('0')) {
      const width = Math.max(numPart.length, numOut.length);
      numOut = numOut.padStart(width, '0');
    }
    return prefix + numOut;
  }

  addRow(): void {
    const nextNum = this.board.rows.length + 1;
    const name =
      this.board.rows.length === 0
        ? 'Row 1'
        : this.nextRowNameAfter(this.board.rows[this.board.rows.length - 1].name, nextNum);
    this.board.rows = [...this.board.rows, { name }];
    this.board.cells[String(this.board.rows.length - 1)] = {};
    this.queueSave();
  }

  requestDeleteRow(rowIndex: number): void {
    this.confirmDeleteRowIndex = rowIndex;
  }

  confirmDeleteRow(rowIndex: number): void {
    this.confirmDeleteRowIndex = null;
    this.removeRow(rowIndex);
  }

  private removeRow(rowIndex: number): void {
    this.board.rows = this.board.rows.filter((_, i) => i !== rowIndex);
    const newCells: Record<string, Record<string, string>> = {};
    const newMeta: Record<string, Record<string, PlotCellMeta>> = {};
    let newIdx = 0;
    for (let i = 0; i < this.board.rows.length + 1; i++) {
      if (i === rowIndex) continue;
      newCells[String(newIdx)] = this.board.cells[String(i)] || {};
      newMeta[String(newIdx)] = this.board.cellMeta[String(i)] || {};
      newIdx++;
    }
    this.board.cells = newCells;
    this.board.cellMeta = newMeta;
    this.queueSave();
  }

  startEditRowName(rowIndex: number): void {
    this.editingRowName = rowIndex;
    this.editingNameValue = this.board.rows[rowIndex].name;
    this.focusNameInputAfterRender('row');
  }

  private focusNameInputAfterRender(which: 'thread' | 'row'): void {
    afterNextRender(() => {
      requestAnimationFrame(() => {
        const el =
          (which === 'thread'
            ? this.threadNameInput?.nativeElement
            : this.rowNameInput?.nativeElement) ??
          (document.querySelector(
            which === 'thread' ? '.thread-name-input' : '.row-name-input'
          ) as HTMLInputElement | null);
        if (el) {
          el.focus({ preventScroll: true });
          el.select();
        }
      });
    }, { injector: this.injector });
  }

  finishEditRowName(): void {
    if (this.editingRowName === null) return;
    this.board.rows[this.editingRowName].name =
      this.editingNameValue.trim() || this.board.rows[this.editingRowName].name;
    this.editingRowName = null;
    this.queueSave();
  }

  // --- Row icon ---

  toggleRowIconPicker(rowIndex: number): void {
    this.showRowIconPicker = this.showRowIconPicker === rowIndex ? null : rowIndex;
  }

  selectRowIcon(rowIndex: number, emoji: string): void {
    const row = this.board.rows[rowIndex];
    if (!row) return;
    row.icon = row.icon === emoji ? undefined : emoji;
    this.showRowIconPicker = null;
    this.queueSave();
  }

  clearRowIcon(rowIndex: number): void {
    const row = this.board.rows[rowIndex];
    if (!row) return;
    row.icon = undefined;
    this.showRowIconPicker = null;
    this.queueSave();
  }

  // --- Cell editing ---

  getCellValue(rowIndex: number, threadId: string): string {
    return this.board.cells[String(rowIndex)]?.[threadId] ?? '';
  }

  getCellMeta(rowIndex: number, threadId: string): PlotCellMeta | null {
    return this.board.cellMeta[String(rowIndex)]?.[threadId] ?? null;
  }

  hasCellContent(rowIndex: number, threadId: string): boolean {
    const text = this.getCellValue(rowIndex, threadId);
    const meta = this.getCellMeta(rowIndex, threadId);
    return !!(text || meta?.icon);
  }

  /** Native tooltip: full cell text (and icon) plus action hint. */
  cellHoverTitle(rowIndex: number, threadId: string): string {
    const text = this.getCellValue(rowIndex, threadId);
    const icon = this.getCellMeta(rowIndex, threadId)?.icon;
    const lines: string[] = [];
    if (text) lines.push(text);
    if (icon) lines.push(icon);
    const body = lines.join('\n');
    return body ? `${body}\n\n${PlotBoardComponent.CELL_EDIT_HINT}` : PlotBoardComponent.CELL_EDIT_HINT;
  }

  threadNameHoverTitle(thread: PlotThread): string {
    const hint = !thread.icon
      ? 'Drag to reorder · Double-click to rename · Hover left of the name to add an icon'
      : 'Drag to reorder · Double-click to rename';
    return `${thread.name}\n\n${hint}`;
  }

  rowNameHoverTitle(row: PlotRow): string {
    return `${row.name}\n\nDrag to reorder · Double-click to rename`;
  }

  /** Grows textarea height to fit content, capped by CSS max-height (15rem). */
  layoutCellEditTextarea(): void {
    const ta = this.cellEditTextarea?.nativeElement;
    if (!ta) return;
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPx = PlotBoardComponent.CELL_EDIT_TEXTAREA_MAX_REM * rootPx;
    ta.style.height = '0';
    ta.style.height = `${Math.min(ta.scrollHeight, maxPx)}px`;
  }

  /** Ctrl+Enter or Cmd+Enter: commit cell edit (same as click-outside save). */
  onCellEditTextareaKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    this.finishEditCell();
  }

  /** Escape closes the popover from textarea, toolbar, swatches, or footer (event bubbles). */
  onCellEditPopoverEscape(event: Event): void {
    if (!this.editingCell) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelEditCell();
  }

  startEditCell(rowIndex: number, threadId: string): void {
    if (this.editingCell) {
      this.finishEditCell();
    }
    this.editingCell = { row: rowIndex, threadId };
    this.keyboardFocusCell = { row: rowIndex, threadId };
    this.editingCellValue = this.getCellValue(rowIndex, threadId);
    const meta = this.getCellMeta(rowIndex, threadId);
    this.editingCellIcon = meta?.icon ?? '';
    this.editingCellColor = meta?.color ?? '';
    this.showEmojiPicker = false;
    this.confirmDeleteCell = false;
    afterNextRender(() => {
      const ta =
        this.cellEditTextarea?.nativeElement ??
        (document.querySelector('.cell-edit-textarea') as HTMLTextAreaElement | null);
      if (ta) {
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
        requestAnimationFrame(() => this.layoutCellEditTextarea());
      }
    }, { injector: this.injector });
  }

  finishEditCell(): void {
    if (!this.editingCell) return;
    const { row, threadId } = this.editingCell;
    const rowKey = String(row);

    if (!this.board.cells[rowKey]) {
      this.board.cells[rowKey] = {};
    }
    const trimmed = this.editingCellValue.trim();
    if (trimmed) {
      this.board.cells[rowKey][threadId] = trimmed;
    } else {
      delete this.board.cells[rowKey][threadId];
    }

    if (!this.board.cellMeta[rowKey]) {
      this.board.cellMeta[rowKey] = {};
    }
    if (this.editingCellIcon || this.editingCellColor) {
      this.board.cellMeta[rowKey][threadId] = {
        ...(this.editingCellIcon ? { icon: this.editingCellIcon } : {}),
        ...(this.editingCellColor ? { color: this.editingCellColor } : {}),
      };
    } else {
      delete this.board.cellMeta[rowKey][threadId];
    }

    this.editingCell = null;
    this.showEmojiPicker = false;
    this.confirmDeleteCell = false;
    this.queueSave();
    this.focusBoardGridForKeyboard();
  }

  cancelEditCell(): void {
    this.editingCell = null;
    this.showEmojiPicker = false;
    this.confirmDeleteCell = false;
    this.focusBoardGridForKeyboard();
  }

  isEditingCell(rowIndex: number, threadId: string): boolean {
    return this.editingCell?.row === rowIndex && this.editingCell?.threadId === threadId;
  }

  toggleEmojiPicker(): void {
    this.showEmojiPicker = !this.showEmojiPicker;
  }

  selectEmoji(emoji: string): void {
    this.editingCellIcon = this.editingCellIcon === emoji ? '' : emoji;
    this.showEmojiPicker = false;
  }

  selectColor(color: string): void {
    this.editingCellColor = this.editingCellColor === color ? '' : color;
  }

  clearIcon(): void {
    this.editingCellIcon = '';
  }

  requestDeleteCell(): void {
    this.confirmDeleteCell = true;
  }

  confirmDeleteCellAction(): void {
    if (!this.editingCell) return;
    const { row, threadId } = this.editingCell;
    const rowKey = String(row);

    if (this.board.cells[rowKey]) {
      delete this.board.cells[rowKey][threadId];
    }
    if (this.board.cellMeta[rowKey]) {
      delete this.board.cellMeta[rowKey][threadId];
    }

    this.editingCell = null;
    this.showEmojiPicker = false;
    this.confirmDeleteCell = false;
    this.queueSave();
    this.focusBoardGridForKeyboard();
  }

  private focusBoardGridForKeyboard(): void {
    afterNextRender(() => {
      this.boardContent?.nativeElement?.focus();
    }, { injector: this.injector });
  }

  isKeyboardFocusCell(rowIndex: number, threadId: string): boolean {
    return (
      !this.editingCell &&
      this.keyboardFocusCell?.row === rowIndex &&
      this.keyboardFocusCell?.threadId === threadId
    );
  }

  onThreadCellPointerDown(rowIndex: number, threadId: string): void {
    this.keyboardFocusCell = { row: rowIndex, threadId: threadId };
  }

  private plotBoardModalsOpen(): boolean {
    return (
      this.showRenameDialog ||
      this.showNewPlotBoardDialog ||
      this.showDeletePlotBoardDialog
    );
  }

  private scrollCellIntoView(row: number, threadId: string): void {
    afterNextRender(() => {
      const safe = (s: string) =>
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(s)
          : s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const el = document.querySelector(
        `.thread-cell[data-nav-row="${row}"][data-nav-thread="${safe(threadId)}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, { injector: this.injector });
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydownNavigateCells(event: KeyboardEvent): void {
    if (!this.hasOpenFile || this.plotBoardModalsOpen() || this.isLoading) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const inTextField =
      !!target &&
      (!!(target as HTMLElement).closest('input, textarea, select') ||
        !!(target as HTMLElement).isContentEditable);

    // New thread (T) / new row (R): work from header focus too; not while editing text.
    if (
      !this.editingCell &&
      this.editingThreadName === null &&
      this.editingRowName === null &&
      !target?.closest('.plot-board-sidebar') &&
      !inTextField
    ) {
      const plainKey =
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.length === 1;
      if (plainKey) {
        const k = event.key.toLowerCase();
        if (k === 't') {
          event.preventDefault();
          this.addThread();
          return;
        }
        if (k === 'r') {
          event.preventDefault();
          this.addRow();
          return;
        }
      }
    }

    if (this.board.rows.length === 0 || this.board.threads.length === 0) {
      return;
    }
    if (this.editingCell) {
      return;
    }
    if (this.editingThreadName !== null || this.editingRowName !== null) {
      return;
    }

    if (target?.closest('.plot-board-sidebar')) {
      return;
    }
    if (target?.closest('app-page-header')) {
      return;
    }
    if (inTextField) {
      return;
    }

    const key = event.key;
    if (
      key !== 'ArrowUp' &&
      key !== 'ArrowDown' &&
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight' &&
      key !== 'Enter'
    ) {
      return;
    }

    const threads = this.board.threads;
    const rowCount = this.board.rows.length;
    const current = this.keyboardFocusCell;

    if (!current) {
      if (key === 'Enter') {
        event.preventDefault();
        const tid = threads[0].id;
        this.keyboardFocusCell = { row: 0, threadId: tid };
        this.startEditCell(0, tid);
        return;
      }
      if (
        key === 'ArrowUp' ||
        key === 'ArrowDown' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight'
      ) {
        event.preventDefault();
        const tid = threads[0].id;
        this.keyboardFocusCell = { row: 0, threadId: tid };
        this.scrollCellIntoView(0, tid);
      }
      return;
    }

    let ti = threads.findIndex((t) => t.id === current.threadId);
    if (ti < 0) {
      this.keyboardFocusCell = null;
      return;
    }
    let ri = current.row;

    if (key === 'Enter') {
      event.preventDefault();
      this.startEditCell(ri, threads[ti].id);
      return;
    }

    event.preventDefault();
    let newTi = ti;
    let newRi = ri;
    switch (key) {
      case 'ArrowUp':
        newRi = Math.max(0, ri - 1);
        break;
      case 'ArrowDown':
        newRi = Math.min(rowCount - 1, ri + 1);
        break;
      case 'ArrowLeft':
        newTi = Math.max(0, ti - 1);
        break;
      case 'ArrowRight':
        newTi = Math.min(threads.length - 1, ti + 1);
        break;
      default:
        return;
    }
    this.keyboardFocusCell = { row: newRi, threadId: threads[newTi].id };
    this.scrollCellIntoView(newRi, threads[newTi].id);
  }

  // --- Drag and drop ---

  private clearDragState(): void {
    this.dragSource = null;
    this.dragOverTarget = null;
    this.dragOverThreadIndex = null;
    this.dragOverRowIndex = null;
  }

  onBoxDragStart(event: DragEvent, row: number, threadId: string): void {
    this.dragSource = { kind: 'cell', row, threadId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${row}:${threadId}`);
    }
    const el = event.target as HTMLElement;
    el.classList.add('dragging');
  }

  onBoxDragEnd(event: DragEvent): void {
    this.clearDragState();
    const el = event.target as HTMLElement;
    el.classList.remove('dragging');
  }

  onThreadNameDragStart(event: DragEvent, threadIndex: number): void {
    if (this.editingThreadName !== null) {
      event.preventDefault();
      return;
    }
    this.dragSource = { kind: 'thread', fromIndex: threadIndex };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-plotboard-thread', String(threadIndex));
    }
    (event.target as HTMLElement).classList.add('dragging');
  }

  onThreadNameDragEnd(event: DragEvent): void {
    this.clearDragState();
    (event.target as HTMLElement).classList.remove('dragging');
  }

  onThreadHeaderDragOver(event: DragEvent, threadIndex: number): void {
    if (this.dragSource?.kind !== 'thread') return;
    if (this.dragSource.fromIndex === threadIndex) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverThreadIndex = threadIndex;
  }

  onThreadHeaderDragLeave(event: DragEvent, threadIndex: number): void {
    const rel = event.relatedTarget as Node | null;
    const cur = event.currentTarget as HTMLElement;
    if (rel && cur.contains(rel)) return;
    if (this.dragOverThreadIndex === threadIndex) {
      this.dragOverThreadIndex = null;
    }
  }

  onThreadHeaderDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.dragSource?.kind !== 'thread') return;
    const from = this.dragSource.fromIndex;
    this.clearDragState();
    if (from === targetIndex) return;
    this.moveThread(from, targetIndex);
  }

  isThreadHeaderDragOver(threadIndex: number): boolean {
    return this.dragOverThreadIndex === threadIndex;
  }

  onRowNameDragStart(event: DragEvent, rowIndex: number): void {
    if (this.editingRowName !== null) {
      event.preventDefault();
      return;
    }
    this.dragSource = { kind: 'row', fromIndex: rowIndex };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-plotboard-row', String(rowIndex));
    }
    (event.target as HTMLElement).classList.add('dragging');
  }

  onRowNameDragEnd(event: DragEvent): void {
    this.clearDragState();
    (event.target as HTMLElement).classList.remove('dragging');
  }

  onRowLabelDragOver(event: DragEvent, rowIndex: number): void {
    if (this.dragSource?.kind !== 'row') return;
    if (this.dragSource.fromIndex === rowIndex) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverRowIndex = rowIndex;
  }

  onRowLabelDragLeave(event: DragEvent, rowIndex: number): void {
    const rel = event.relatedTarget as Node | null;
    const cur = event.currentTarget as HTMLElement;
    if (rel && cur.contains(rel)) return;
    if (this.dragOverRowIndex === rowIndex) {
      this.dragOverRowIndex = null;
    }
  }

  onRowLabelDrop(event: DragEvent, targetIndex: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.dragSource?.kind !== 'row') return;
    const from = this.dragSource.fromIndex;
    this.clearDragState();
    if (from === targetIndex) return;
    this.moveRow(from, targetIndex);
  }

  isRowLabelDragOver(rowIndex: number): boolean {
    return this.dragOverRowIndex === rowIndex;
  }

  /** Reorder columns; cell keys stay thread ids — no cell data remap. */
  private moveThread(from: number, to: number): void {
    if (from === to) return;
    const threads = [...this.board.threads];
    const [moved] = threads.splice(from, 1);
    // After removal, insert at `to` so the item lands on the dropped index (incl. last).
    threads.splice(to, 0, moved);
    this.board.threads = threads;
    this.queueSave();
  }

  /** Reorder rows and remap `cells` / `cellMeta` row keys. */
  private moveRow(from: number, to: number): void {
    const n = this.board.rows.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
    const tracked = this.board.rows.map((r, i) => ({ r, oldIdx: i }));
    const [removed] = tracked.splice(from, 1);
    tracked.splice(to, 0, removed);

    this.board.rows = tracked.map((x) => x.r);
    const newCells: Record<string, Record<string, string>> = {};
    const newMeta: Record<string, Record<string, PlotCellMeta>> = {};
    for (let ni = 0; ni < n; ni++) {
      const oi = tracked[ni].oldIdx;
      newCells[String(ni)] = { ...(this.board.cells[String(oi)] || {}) };
      newMeta[String(ni)] = { ...(this.board.cellMeta[String(oi)] || {}) };
    }
    this.board.cells = newCells;
    this.board.cellMeta = newMeta;

    if (this.keyboardFocusCell) {
      const newRow = tracked.findIndex((x) => x.oldIdx === this.keyboardFocusCell!.row);
      if (newRow >= 0) {
        this.keyboardFocusCell = { ...this.keyboardFocusCell, row: newRow };
      }
    }
    if (this.editingRowName !== null) {
      const cur = this.editingRowName;
      const newIdx = tracked.findIndex((x) => x.oldIdx === cur);
      this.editingRowName = newIdx >= 0 ? newIdx : null;
    }
    if (this.confirmDeleteRowIndex !== null) {
      const cur = this.confirmDeleteRowIndex;
      const newIdx = tracked.findIndex((x) => x.oldIdx === cur);
      this.confirmDeleteRowIndex = newIdx >= 0 ? newIdx : null;
    }
    if (this.showRowIconPicker !== null) {
      const cur = this.showRowIconPicker;
      const newIdx = tracked.findIndex((x) => x.oldIdx === cur);
      this.showRowIconPicker = newIdx >= 0 ? newIdx : null;
    }

    this.queueSave();
  }

  onCellDragOver(event: DragEvent, row: number, threadId: string): void {
    if (this.dragSource?.kind !== 'cell') return;
    if (this.dragSource.row === row && this.dragSource.threadId === threadId) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverTarget = { row, threadId };
  }

  onCellDragLeave(event: DragEvent, row: number, threadId: string): void {
    if (
      this.dragOverTarget?.row === row &&
      this.dragOverTarget?.threadId === threadId
    ) {
      this.dragOverTarget = null;
    }
  }

  onCellDrop(event: DragEvent, targetRow: number, targetThreadId: string): void {
    event.preventDefault();
    if (this.dragSource?.kind !== 'cell') return;

    const { row: srcRow, threadId: srcThreadId } = this.dragSource;
    if (srcRow === targetRow && srcThreadId === targetThreadId) {
      this.clearDragState();
      return;
    }

    const srcRowKey = String(srcRow);
    const tgtRowKey = String(targetRow);

    const srcText = this.board.cells[srcRowKey]?.[srcThreadId] ?? '';
    const tgtText = this.board.cells[tgtRowKey]?.[targetThreadId] ?? '';
    const srcMeta = this.board.cellMeta[srcRowKey]?.[srcThreadId] ?? null;
    const tgtMeta = this.board.cellMeta[tgtRowKey]?.[targetThreadId] ?? null;

    if (!this.board.cells[tgtRowKey]) this.board.cells[tgtRowKey] = {};
    if (!this.board.cells[srcRowKey]) this.board.cells[srcRowKey] = {};
    if (!this.board.cellMeta[tgtRowKey]) this.board.cellMeta[tgtRowKey] = {};
    if (!this.board.cellMeta[srcRowKey]) this.board.cellMeta[srcRowKey] = {};

    if (srcText) {
      this.board.cells[tgtRowKey][targetThreadId] = srcText;
    } else {
      delete this.board.cells[tgtRowKey][targetThreadId];
    }
    if (tgtText) {
      this.board.cells[srcRowKey][srcThreadId] = tgtText;
    } else {
      delete this.board.cells[srcRowKey][srcThreadId];
    }

    if (srcMeta) {
      this.board.cellMeta[tgtRowKey][targetThreadId] = srcMeta;
    } else {
      delete this.board.cellMeta[tgtRowKey][targetThreadId];
    }
    if (tgtMeta) {
      this.board.cellMeta[srcRowKey][srcThreadId] = tgtMeta;
    } else {
      delete this.board.cellMeta[srcRowKey][srcThreadId];
    }

    this.clearDragState();
    this.queueSave();
  }

  isDragOver(rowIndex: number, threadId: string): boolean {
    return this.dragOverTarget?.row === rowIndex && this.dragOverTarget?.threadId === threadId;
  }

  // --- Character linking ---

  getThreadCharacters(threadId: string): Character[] {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return [];
    return this.characters.filter((c) => thread.characters.includes(c.id));
  }

  async addCharacterToThread(threadId: string): Promise<void> {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;

    const character = await this.characterPickerService.pick();
    if (!character) return;

    if (!thread.characters.includes(character.id)) {
      thread.characters = [...thread.characters, character.id];
      this.queueSave();
      this.refreshThumbnails();
    }
  }

  onCharacterThumbClick(threadId: string, characterId: string): void {
    if (
      this.confirmRemoveCharacter?.threadId === threadId &&
      this.confirmRemoveCharacter?.characterId === characterId
    ) {
      const thread = this.board.threads.find((t) => t.id === threadId);
      if (thread) {
        thread.characters = thread.characters.filter((id) => id !== characterId);
        this.queueSave();
      }
      this.confirmRemoveCharacter = null;
    } else {
      this.confirmRemoveCharacter = { threadId, characterId };
    }
  }

  isCharacterPendingRemoval(threadId: string, characterId: string): boolean {
    return (
      this.confirmRemoveCharacter?.threadId === threadId &&
      this.confirmRemoveCharacter?.characterId === characterId
    );
  }
}
