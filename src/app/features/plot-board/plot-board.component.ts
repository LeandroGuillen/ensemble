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
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { ActivatedRoute, Router, UrlSegment } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { PlotBoardService } from '../../core/services/plot-board.service';
import { CharacterService } from '../../core/services/character.service';
import { CharacterPickerService } from '../../core/services/character-picker.service';
import { ProjectService } from '../../core/services/project.service';
import { LoggingService } from '../../core/services/logging.service';
import { ColorPaletteService } from '../../core/services/color-palette.service';
import { PlotBoard, PlotCellMeta, PlotRow, PlotThread } from '../../core/interfaces/plot-board.interface';
import { Character } from '../../core/interfaces/character.interface';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { EmojiPickerComponent } from '../../shared/emoji-picker/emoji-picker.component';
import { ConfirmButtonDirective } from '../../shared/confirm-button/confirm-button.directive';
import { PlotBoardReorderService } from './plot-board-reorder.service';
import { PlotBoardSidebarComponent } from './components/plot-board-sidebar/plot-board-sidebar.component';
import { ThreadToolbarComponent } from './components/thread-toolbar/thread-toolbar.component';
import { ThreadToolbarService } from './components/thread-toolbar/thread-toolbar.service';
import { CellEditorPopoverComponent } from './components/cell-editor-popover/cell-editor-popover.component';

export type ZoomLevel = 1 | 2 | 3;

@Component({
  selector: 'app-plot-board',
  imports: [
    FormsModule,
    PageHeaderComponent,
    EmojiPickerComponent,
    ConfirmButtonDirective,
    PlotBoardSidebarComponent,
    ThreadToolbarComponent,
    CellEditorPopoverComponent,
  ],
  providers: [PlotBoardReorderService, ThreadToolbarService],
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
      state('open', style({ width: '240px' })),
      state('closed', style({ width: '0', overflow: 'hidden' })),
      transition('open <=> closed', [
        animate('240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'),
      ]),
    ]),
  ],
})
export class PlotBoardComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private saveRequest$ = new Subject<void>();
  private suspendAutoSave = false;

  board: PlotBoard = { threads: [], rows: [], cells: {}, cellMeta: {} };
  characters: Character[] = [];
  isLoading = false;
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
  cellSaveShortcutModifierLabel = 'Ctrl';

  showThreadIconPicker: string | null = null;
  showThreadColorPicker: string | null = null;
  showRowIconPicker: number | null = null;

  confirmRemoveCharacter: { threadId: string; characterId: string } | null = null;
  confirmDeleteThreadId: string | null = null;
  confirmDeleteRowIndex: number | null = null;
  confirmDeleteCell = false;

  paletteColors: string[] = [];
  thumbnailCache: Map<string, string> = new Map();

  plotboardPaths: string[] = [];
  private resolvingEmptyRoute = false;

  @ViewChild('boardContent') boardContent?: ElementRef<HTMLElement>;
  @ViewChild('threadNameInput') threadNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('rowNameInput') rowNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild(PlotBoardSidebarComponent) sidebar?: PlotBoardSidebarComponent;

  private static readonly CELL_EDIT_HINT = 'Double-click to edit · Drag to move';
  private static readonly PLOTBOARD_SIDEBAR_STORAGE_KEY = 'ensemble.plotBoard.sidebarOpen';

  plotboardSidebarOpen = true;
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
    private injector: Injector,
    readonly reorder: PlotBoardReorderService,
    readonly threadToolbar: ThreadToolbarService
  ) {}

  private readonly onBoardContentScroll = (): void => {
    this.ngZone.run(() =>
      this.threadToolbar.refreshActiveLayout(this.confirmDeleteThreadId, this.showThreadColorPicker)
    );
  };

  ngOnInit(): void {
    try {
      const v = localStorage.getItem(PlotBoardComponent.PLOTBOARD_SIDEBAR_STORAGE_KEY);
      if (v === '0') this.plotboardSidebarOpen = false;
      else if (v === '1') this.plotboardSidebarOpen = true;
    } catch {
      /* ignore */
    }

    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      this.cellSaveShortcutModifierLabel = '⌘';
    }

    this.saveRequest$
      .pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.persistBoard());

    this.characterService.characters$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((chars) => {
        this.characters = chars;
        this.refreshThumbnails();
      });

    this.colorPaletteService.palette$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.paletteColors = this.colorPaletteService.getAllColors();
      });

    this.route.url.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((segments) => {
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
    this.threadToolbar.destroy();
    void this.flushSaveIfNeeded();
  }

  onThreadNameRowEnter(threadId: string, anchor: HTMLElement): void {
    if (this.showThreadColorPicker !== null && this.showThreadColorPicker !== threadId) {
      this.showThreadColorPicker = null;
    }
    this.threadToolbar.onNameRowEnter(threadId, anchor);
  }

  onThreadNameRowLeave(threadId: string): void {
    this.threadToolbar.onNameRowLeave(threadId, this.confirmDeleteThreadId, this.showThreadColorPicker);
  }

  @HostListener('window:resize')
  onWindowResizeForThreadToolbar(): void {
    this.threadToolbar.refreshActiveLayout(this.confirmDeleteThreadId, this.showThreadColorPicker);
  }

  onPathsChange(paths: string[]): void {
    this.plotboardPaths = paths;
  }

  onSidebarOpenChange(open: boolean): void {
    this.plotboardSidebarOpen = open;
  }

  onSuspendAutoSaveChange(suspend: boolean): void {
    this.suspendAutoSave = suspend;
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

  get boardContentKey(): string {
    return this.displayedBoardPath ?? '__none__';
  }

  get pageTitle(): string {
    const p = this.plotBoardService.getCurrentRelativePath();
    if (!p) return 'Plot Board';
    const base = p.split('/').pop() ?? p;
    return base
      .replace(/\.pinboard\.md$/i, '')
      .replace(/\.plotboard\.md$/i, '')
      .replace(/-/g, ' ');
  }

  get currentPlotboardPath(): string | null {
    return this.plotBoardService.getCurrentRelativePath();
  }

  private pathSegmentsForRouter(relativePath: string): string[] {
    return relativePath.split('/').filter((s) => s.length > 0);
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
      await this.sidebar?.refreshList();
      await this.refreshThumbnails();
    } catch (error) {
      this.logger.error('Failed to load plot board', error);
    } finally {
      this.displayedBoardPath = this.plotBoardService.getCurrentRelativePath();
      this.isLoading = false;
      this.keyboardFocusCell = null;
      this.suspendAutoSave = false;
    }
  }

  private async handleEmptyPlotBoardRoute(): Promise<void> {
    if (this.resolvingEmptyRoute) return;
    this.resolvingEmptyRoute = true;
    try {
      const paths = (await this.sidebar?.refreshList()) ?? this.plotboardPaths;
      const last = this.projectService.getLastPlotboardPath();
      const norm = last ? this.plotBoardService.normalizeRelativePath(last) : null;
      const target = norm && paths.includes(norm) ? norm : paths[0] ?? null;
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

  private isBoardSyncedToOpenFile(): boolean {
    const path = this.plotBoardService.getCurrentRelativePath();
    if (!path || !this.displayedBoardPath) return false;
    const norm = (p: string) => this.plotBoardService.normalizeRelativePath(p);
    return norm(this.displayedBoardPath) === norm(path);
  }

  async onBeforeNavigate(): Promise<void> {
    await this.flushSaveIfNeeded();
  }

  async flushSaveIfNeeded(): Promise<void> {
    if (this.suspendAutoSave) return;
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
    if (this.suspendAutoSave) return;
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
      const styleId = this.projectService.getDefaultCharacterStyle();
      const cached = this.characterService.getCachedThumbnail(cid, styleId);
      if (cached) {
        this.thumbnailCache.set(cid, cached);
      } else {
        const loaded = await this.characterService.loadThumbnailForCharacter(char, styleId);
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

    if (this.confirmDeleteThreadId !== null && !target.closest('.confirm-delete-btn, .btn-danger, [appConfirmButton]')) {
      this.confirmDeleteThreadId = null;
    }
    if (this.confirmDeleteRowIndex !== null && !target.closest('.confirm-delete-btn, .btn-danger, [appConfirmButton]')) {
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

  addThread(): void {
    const name = 'New Thread';
    const id = this.plotBoardService.generateThreadId(name, this.board.threads);
    this.board.threads = [...this.board.threads, { id, name, characters: [] }];
    this.queueSave();
  }

  requestDeleteThread(threadId: string): void {
    this.confirmDeleteThreadId = threadId || null;
  }

  confirmDeleteThread(threadId: string): void {
    this.confirmDeleteThreadId = null;
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

  onToggleThreadColorPicker(threadId: string): void {
    if (this.showThreadColorPicker === threadId) {
      this.showThreadColorPicker = null;
      return;
    }
    this.showThreadColorPicker = threadId;
    this.threadToolbar.registerAnchorForColorPicker(threadId);
  }

  onSelectThreadColor(event: { threadId: string; color: string }): void {
    const thread = this.board.threads.find((t) => t.id === event.threadId);
    if (!thread) return;
    thread.color = event.color ? (thread.color === event.color ? undefined : event.color) : undefined;
    this.showThreadColorPicker = null;
    this.queueSave();
  }

  onClearThreadColor(threadId: string): void {
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

  private nextRowNameAfter(lastName: string, fallbackIndex: number): string {
    const trimmed = lastName.trim();
    const m = trimmed.match(/^(.*?)(\d+)$/);
    if (!m) return `Row ${fallbackIndex}`;
    const prefix = m[1];
    const numPart = m[2];
    const n = parseInt(numPart, 10) + 1;
    if (!Number.isFinite(n)) return `Row ${fallbackIndex}`;
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

  onRowDeleteArmed(rowIndex: number, armed: boolean): void {
    this.confirmDeleteRowIndex = armed ? rowIndex : null;
  }

  confirmDeleteRow(rowIndex: number): void {
    this.confirmDeleteRowIndex = null;
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

  getCellValue(rowIndex: number, threadId: string): string {
    return this.board.cells[String(rowIndex)]?.[threadId] ?? '';
  }

  getCellMeta(rowIndex: number, threadId: string) {
    return this.board.cellMeta[String(rowIndex)]?.[threadId] ?? null;
  }

  hasCellContent(rowIndex: number, threadId: string): boolean {
    const text = this.getCellValue(rowIndex, threadId);
    const meta = this.getCellMeta(rowIndex, threadId);
    return !!(text || meta?.icon);
  }

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
    return this.sidebar?.modalsOpen() ?? false;
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

    if (
      !this.editingCell &&
      this.editingThreadName === null &&
      this.editingRowName === null &&
      !target?.closest('.plot-board-sidebar') &&
      !inTextField
    ) {
      const plainKey =
        !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1;
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

    if (this.board.rows.length === 0 || this.board.threads.length === 0) return;
    if (this.editingCell) return;
    if (this.editingThreadName !== null || this.editingRowName !== null) return;
    if (target?.closest('.plot-board-sidebar')) return;
    if (target?.closest('app-page-header')) return;
    if (inTextField) return;

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
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
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
    const ri = current.row;

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

  onThreadHeaderDrop(event: DragEvent, targetIndex: number): void {
    const result = this.reorder.onThreadHeaderDrop(event, targetIndex);
    if (!result) return;
    this.board = this.reorder.moveThread(this.board, result.from, result.to);
    this.queueSave();
  }

  onRowLabelDrop(event: DragEvent, targetIndex: number): void {
    const result = this.reorder.onRowLabelDrop(event, targetIndex);
    if (!result) return;
    const moved = this.reorder.moveRow(this.board, result.from, result.to, {
      keyboardFocusRow: this.keyboardFocusCell?.row ?? null,
      editingRowName: this.editingRowName,
      confirmDeleteRowIndex: this.confirmDeleteRowIndex,
      showRowIconPicker: this.showRowIconPicker,
    });
    this.board = moved.board;
    if (this.keyboardFocusCell) {
      const newRow = moved.ui.keyboardFocusRow;
      if (newRow !== null && newRow >= 0) {
        this.keyboardFocusCell = { ...this.keyboardFocusCell, row: newRow };
      }
    }
    this.editingRowName = moved.ui.editingRowName;
    this.confirmDeleteRowIndex = moved.ui.confirmDeleteRowIndex;
    this.showRowIconPicker = moved.ui.showRowIconPicker;
    this.queueSave();
  }

  onCellDrop(event: DragEvent, targetRow: number, targetThreadId: string): void {
    const swap = this.reorder.onCellDrop(event, targetRow, targetThreadId);
    if (!swap) return;
    this.board = this.reorder.applyCellSwap(
      this.board,
      swap.srcRow,
      swap.srcThreadId,
      swap.targetRow,
      swap.targetThreadId
    );
    this.queueSave();
  }

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
