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
import { PlotBoard, PlotThread } from '../../core/interfaces/plot-board.interface';
import { Character } from '../../core/interfaces/character.interface';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

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

  board: PlotBoard = { threads: [], rows: [], cells: {} };
  characters: Character[] = [];
  isLoading = false;

  editingCell: { row: number; threadId: string } | null = null;
  editingRowName: number | null = null;
  editingThreadName: string | null = null;
  editingCellValue = '';
  editingNameValue = '';

  confirmDeleteThreadId: string | null = null;
  confirmDeleteRowIndex: number | null = null;

  constructor(
    private plotBoardService: PlotBoardService,
    private characterService: CharacterService,
    private characterPickerService: CharacterPickerService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {}

  ngOnInit(): void {
    this.saveRequest$
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe(() => this.persistBoard());

    this.characterService.characters$
      .pipe(takeUntil(this.destroy$))
      .subscribe((chars) => (this.characters = chars));

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async load(): Promise<void> {
    this.isLoading = true;
    try {
      await this.plotBoardService.loadPlotBoard();
      const loaded = this.plotBoardService.getPlotBoard();
      if (loaded) {
        this.board = loaded;
      }

      const project = this.projectService.getCurrentProject();
      if (project?.path) {
        await this.characterService.loadCharacters(project.path);
      }
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

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (this.confirmDeleteThreadId !== null && !target.closest('.confirm-delete-btn, .btn-danger')) {
      this.confirmDeleteThreadId = null;
    }
    if (this.confirmDeleteRowIndex !== null && !target.closest('.confirm-delete-btn, .btn-danger')) {
      this.confirmDeleteRowIndex = null;
    }

    if (this.editingCell && !target.closest('.data-cell.editing')) {
      this.finishEditCell();
    }
    if (this.editingRowName !== null && !target.closest('.row-label')) {
      this.finishEditRowName();
    }
    if (this.editingThreadName !== null && !target.closest('.thread-header')) {
      this.finishEditThreadName();
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
      thread.name = this.editingNameValue.trim() || thread.name;
    }
    this.editingThreadName = null;
    this.queueSave();
  }

  // --- Row management ---

  addRow(): void {
    const nextNum = this.board.rows.length + 1;
    this.board.rows = [...this.board.rows, `Row ${nextNum}`];
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
    let newIdx = 0;
    for (let i = 0; i < this.board.rows.length + 1; i++) {
      if (i === rowIndex) continue;
      newCells[String(newIdx)] = this.board.cells[String(i)] || {};
      newIdx++;
    }
    this.board.cells = newCells;
    this.queueSave();
  }

  startEditRowName(rowIndex: number): void {
    this.editingRowName = rowIndex;
    this.editingNameValue = this.board.rows[rowIndex];
    setTimeout(() => {
      const input = document.querySelector('.row-name-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  finishEditRowName(): void {
    if (this.editingRowName === null) return;
    this.board.rows[this.editingRowName] = this.editingNameValue.trim() || this.board.rows[this.editingRowName];
    this.editingRowName = null;
    this.queueSave();
  }

  // --- Cell editing ---

  getCellValue(rowIndex: number, threadId: string): string {
    return this.board.cells[String(rowIndex)]?.[threadId] ?? '';
  }

  startEditCell(rowIndex: number, threadId: string): void {
    this.editingCell = { row: rowIndex, threadId };
    this.editingCellValue = this.getCellValue(rowIndex, threadId);
    setTimeout(() => {
      const input = document.querySelector('.cell-input') as HTMLTextAreaElement;
      input?.focus();
    }, 0);
  }

  finishEditCell(): void {
    if (!this.editingCell) return;
    const { row, threadId } = this.editingCell;
    if (!this.board.cells[String(row)]) {
      this.board.cells[String(row)] = {};
    }
    const trimmed = this.editingCellValue.trim();
    if (trimmed) {
      this.board.cells[String(row)][threadId] = trimmed;
    } else {
      delete this.board.cells[String(row)][threadId];
    }
    this.editingCell = null;
    this.queueSave();
  }

  cancelEditCell(): void {
    this.editingCell = null;
  }

  isEditingCell(rowIndex: number, threadId: string): boolean {
    return this.editingCell?.row === rowIndex && this.editingCell?.threadId === threadId;
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
    }
  }

  removeCharacterFromThread(threadId: string, characterId: string): void {
    const thread = this.board.threads.find((t) => t.id === threadId);
    if (!thread) return;
    thread.characters = thread.characters.filter((id) => id !== characterId);
    this.queueSave();
  }
}
