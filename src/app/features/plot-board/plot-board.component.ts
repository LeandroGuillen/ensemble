import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { PlotBoardService } from '../../core/services/plot-board.service';
import { CharacterService } from '../../core/services/character.service';
import { CharacterPickerService } from '../../core/services/character-picker.service';
import { ProjectService } from '../../core/services/project.service';
import { LoggingService } from '../../core/services/logging.service';
import { ColorPaletteService } from '../../core/services/color-palette.service';
import { PlotBoard, PlotCellMeta, PlotRow } from '../../core/interfaces/plot-board.interface';
import { Character } from '../../core/interfaces/character.interface';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

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
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './plot-board.component.html',
  styleUrls: ['./plot-board.component.scss'],
})
export class PlotBoardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private saveRequest$ = new Subject<void>();

  board: PlotBoard = { threads: [], rows: [], cells: {}, cellMeta: {} };
  characters: Character[] = [];
  isLoading = false;
  zoomLevel: ZoomLevel = 3;

  editingCell: { row: number; threadId: string } | null = null;
  editingRowName: number | null = null;
  editingThreadName: string | null = null;
  editingCellValue = '';
  editingCellIcon = '';
  editingCellColor = '';
  editingNameValue = '';
  showEmojiPicker = false;

  // Icon/color pickers for thread headers and row labels
  showThreadIconPicker: string | null = null;
  showThreadColorPicker: string | null = null;
  showRowIconPicker: number | null = null;

  confirmRemoveCharacter: { threadId: string; characterId: string } | null = null;
  confirmDeleteThreadId: string | null = null;
  confirmDeleteRowIndex: number | null = null;
  confirmDeleteCell = false;

  dragSource: { row: number; threadId: string } | null = null;
  dragOverTarget: { row: number; threadId: string } | null = null;

  paletteColors: string[] = [];
  emojiGroups = EMOJI_GROUPS;

  thumbnailCache: Map<string, string> = new Map();

  constructor(
    private plotBoardService: PlotBoardService,
    private characterService: CharacterService,
    private characterPickerService: CharacterPickerService,
    private projectService: ProjectService,
    private logger: LoggingService,
    private colorPaletteService: ColorPaletteService
  ) {}

  ngOnInit(): void {
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

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get gridTemplateColumns(): string {
    const labelWidth = this.zoomLevel === 1 ? '80px' : this.zoomLevel === 2 ? '120px' : '160px';
    return `${labelWidth} repeat(${this.board.threads.length}, 1fr)`;
  }

  get zoomClass(): string {
    return `zoom-${this.zoomLevel}`;
  }

  setZoom(level: ZoomLevel): void {
    this.zoomLevel = level;
    this.projectService.saveplotBoardZoom(level);
  }

  private async load(): Promise<void> {
    this.isLoading = true;
    try {
      const savedZoom = this.projectService.getPlotBoardZoom();
      if (savedZoom && [1, 2, 3].includes(savedZoom)) {
        this.zoomLevel = savedZoom as ZoomLevel;
      }

      await this.plotBoardService.loadPlotBoard();
      const loaded = this.plotBoardService.getPlotBoard();
      if (loaded) {
        this.board = loaded;
      }

      const project = this.projectService.getCurrentProject();
      if (project?.path) {
        await this.characterService.loadCharacters(project.path);
      }
      await this.refreshThumbnails();
    } catch (error) {
      this.logger.error('Failed to load plot board', error);
    } finally {
      this.isLoading = false;
    }
  }

  private queueSave(): void {
    this.saveRequest$.next();
  }

  private async persistBoard(): Promise<void> {
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
    if (this.editingThreadName !== null && !target.closest('.thread-header')) {
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
    setTimeout(() => {
      const input = document.querySelector('.thread-name-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
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
    this.showThreadColorPicker = this.showThreadColorPicker === threadId ? null : threadId;
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

  addRow(): void {
    const nextNum = this.board.rows.length + 1;
    this.board.rows = [...this.board.rows, { name: `Row ${nextNum}` }];
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
    setTimeout(() => {
      const input = document.querySelector('.row-name-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
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

  startEditCell(rowIndex: number, threadId: string): void {
    if (this.editingCell) {
      this.finishEditCell();
    }
    this.editingCell = { row: rowIndex, threadId };
    this.editingCellValue = this.getCellValue(rowIndex, threadId);
    const meta = this.getCellMeta(rowIndex, threadId);
    this.editingCellIcon = meta?.icon ?? '';
    this.editingCellColor = meta?.color ?? '';
    this.showEmojiPicker = false;
    this.confirmDeleteCell = false;
    setTimeout(() => {
      const input = document.querySelector('.cell-edit-textarea') as HTMLTextAreaElement;
      input?.focus();
    }, 0);
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
    this.queueSave();
  }

  cancelEditCell(): void {
    this.editingCell = null;
    this.showEmojiPicker = false;
    this.confirmDeleteCell = false;
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
  }

  // --- Drag and drop ---

  onBoxDragStart(event: DragEvent, row: number, threadId: string): void {
    this.dragSource = { row, threadId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${row}:${threadId}`);
    }
    const el = event.target as HTMLElement;
    el.classList.add('dragging');
  }

  onBoxDragEnd(event: DragEvent): void {
    this.dragSource = null;
    this.dragOverTarget = null;
    const el = event.target as HTMLElement;
    el.classList.remove('dragging');
  }

  onCellDragOver(event: DragEvent, row: number, threadId: string): void {
    if (!this.dragSource) return;
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
    if (!this.dragSource) return;

    const { row: srcRow, threadId: srcThreadId } = this.dragSource;
    if (srcRow === targetRow && srcThreadId === targetThreadId) {
      this.dragSource = null;
      this.dragOverTarget = null;
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

    this.dragSource = null;
    this.dragOverTarget = null;
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
