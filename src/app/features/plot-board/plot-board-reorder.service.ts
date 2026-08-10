import { Injectable } from '@angular/core';
import { PlotBoard, PlotCellMeta } from '../../core/interfaces/plot-board.interface';

export type PlotBoardDragSource =
  | { kind: 'cell'; row: number; threadId: string }
  | { kind: 'row'; fromIndex: number }
  | { kind: 'thread'; fromIndex: number };

export interface PlotBoardDragOverTarget {
  row: number;
  threadId: string;
}

/** UI indices that must be remapped when rows are reordered. */
export interface RowReorderUiState {
  keyboardFocusRow: number | null;
  editingRowName: number | null;
  confirmDeleteRowIndex: number | null;
  showRowIconPicker: number | null;
}

export interface RowReorderUiResult {
  keyboardFocusRow: number | null;
  editingRowName: number | null;
  confirmDeleteRowIndex: number | null;
  showRowIconPicker: number | null;
}

@Injectable()
export class PlotBoardReorderService {
  dragSource: PlotBoardDragSource | null = null;
  dragOverTarget: PlotBoardDragOverTarget | null = null;
  dragOverThreadIndex: number | null = null;
  dragOverRowIndex: number | null = null;

  clearDragState(): void {
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
    (event.target as HTMLElement).classList.add('dragging');
  }

  onBoxDragEnd(event: DragEvent): void {
    this.clearDragState();
    (event.target as HTMLElement).classList.remove('dragging');
  }

  onThreadNameDragStart(event: DragEvent, threadIndex: number, editingThreadName: string | null): void {
    if (editingThreadName !== null) {
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

  onThreadHeaderDrop(event: DragEvent, targetIndex: number): { moved: boolean; from: number; to: number } | null {
    event.preventDefault();
    event.stopPropagation();
    if (this.dragSource?.kind !== 'thread') return null;
    const from = this.dragSource.fromIndex;
    this.clearDragState();
    if (from === targetIndex) return null;
    return { moved: true, from, to: targetIndex };
  }

  isThreadHeaderDragOver(threadIndex: number): boolean {
    return this.dragOverThreadIndex === threadIndex;
  }

  onRowNameDragStart(event: DragEvent, rowIndex: number, editingRowName: number | null): void {
    if (editingRowName !== null) {
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

  onRowLabelDrop(event: DragEvent, targetIndex: number): { moved: boolean; from: number; to: number } | null {
    event.preventDefault();
    event.stopPropagation();
    if (this.dragSource?.kind !== 'row') return null;
    const from = this.dragSource.fromIndex;
    this.clearDragState();
    if (from === targetIndex) return null;
    return { moved: true, from, to: targetIndex };
  }

  isRowLabelDragOver(rowIndex: number): boolean {
    return this.dragOverRowIndex === rowIndex;
  }

  /** Reorder columns; cell keys stay thread ids — no cell data remap. */
  moveThread(board: PlotBoard, from: number, to: number): PlotBoard {
    if (from === to) return board;
    const threads = [...board.threads];
    const [moved] = threads.splice(from, 1);
    threads.splice(to, 0, moved);
    return { ...board, threads };
  }

  /** Reorder rows and remap `cells` / `cellMeta` row keys. */
  moveRow(board: PlotBoard, from: number, to: number, ui: RowReorderUiState): { board: PlotBoard; ui: RowReorderUiResult } {
    const n = board.rows.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) {
      return {
        board,
        ui: {
          keyboardFocusRow: ui.keyboardFocusRow,
          editingRowName: ui.editingRowName,
          confirmDeleteRowIndex: ui.confirmDeleteRowIndex,
          showRowIconPicker: ui.showRowIconPicker,
        },
      };
    }

    const tracked = board.rows.map((r, i) => ({ r, oldIdx: i }));
    const [removed] = tracked.splice(from, 1);
    tracked.splice(to, 0, removed);

    const rows = tracked.map((x) => x.r);
    const newCells: Record<string, Record<string, string>> = {};
    const newMeta: Record<string, Record<string, PlotCellMeta>> = {};
    for (let ni = 0; ni < n; ni++) {
      const oi = tracked[ni].oldIdx;
      newCells[String(ni)] = { ...(board.cells[String(oi)] || {}) };
      newMeta[String(ni)] = { ...(board.cellMeta[String(oi)] || {}) };
    }

    const remapIdx = (cur: number | null): number | null => {
      if (cur === null) return null;
      const newIdx = tracked.findIndex((x) => x.oldIdx === cur);
      return newIdx >= 0 ? newIdx : null;
    };

    return {
      board: { ...board, rows, cells: newCells, cellMeta: newMeta },
      ui: {
        keyboardFocusRow: remapIdx(ui.keyboardFocusRow),
        editingRowName: remapIdx(ui.editingRowName),
        confirmDeleteRowIndex: remapIdx(ui.confirmDeleteRowIndex),
        showRowIconPicker: remapIdx(ui.showRowIconPicker),
      },
    };
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

  onCellDragLeave(_event: DragEvent, row: number, threadId: string): void {
    if (this.dragOverTarget?.row === row && this.dragOverTarget?.threadId === threadId) {
      this.dragOverTarget = null;
    }
  }

  onCellDrop(
    event: DragEvent,
    targetRow: number,
    targetThreadId: string
  ): { srcRow: number; srcThreadId: string; targetRow: number; targetThreadId: string } | null {
    event.preventDefault();
    if (this.dragSource?.kind !== 'cell') return null;

    const { row: srcRow, threadId: srcThreadId } = this.dragSource;
    this.clearDragState();

    if (srcRow === targetRow && srcThreadId === targetThreadId) {
      return null;
    }

    return { srcRow, srcThreadId, targetRow, targetThreadId };
  }

  /** Swap two cells on a copy of the given board. */
  applyCellSwap(board: PlotBoard, srcRow: number, srcThreadId: string, targetRow: number, targetThreadId: string): PlotBoard {
    const srcRowKey = String(srcRow);
    const tgtRowKey = String(targetRow);

    const cells = { ...board.cells };
    const cellMeta = { ...board.cellMeta };

    if (!cells[tgtRowKey]) cells[tgtRowKey] = {};
    if (!cells[srcRowKey]) cells[srcRowKey] = {};
    if (!cellMeta[tgtRowKey]) cellMeta[tgtRowKey] = {};
    if (!cellMeta[srcRowKey]) cellMeta[srcRowKey] = {};

    const tgtCells = { ...cells[tgtRowKey] };
    const srcCells = { ...cells[srcRowKey] };
    const tgtMeta = { ...cellMeta[tgtRowKey] };
    const srcMetaRow = { ...cellMeta[srcRowKey] };

    const srcText = srcCells[srcThreadId] ?? '';
    const tgtText = tgtCells[targetThreadId] ?? '';
    const srcMeta = srcMetaRow[srcThreadId] ?? null;
    const tgtMetaVal = tgtMeta[targetThreadId] ?? null;

    if (srcText) {
      tgtCells[targetThreadId] = srcText;
    } else {
      delete tgtCells[targetThreadId];
    }
    if (tgtText) {
      srcCells[srcThreadId] = tgtText;
    } else {
      delete srcCells[srcThreadId];
    }

    if (srcMeta) {
      tgtMeta[targetThreadId] = srcMeta;
    } else {
      delete tgtMeta[targetThreadId];
    }
    if (tgtMetaVal) {
      srcMetaRow[srcThreadId] = tgtMetaVal;
    } else {
      delete srcMetaRow[srcThreadId];
    }

    cells[tgtRowKey] = tgtCells;
    cells[srcRowKey] = srcCells;
    cellMeta[tgtRowKey] = tgtMeta;
    cellMeta[srcRowKey] = srcMetaRow;

    return { ...board, cells, cellMeta };
  }

  isDragOver(rowIndex: number, threadId: string): boolean {
    return this.dragOverTarget?.row === rowIndex && this.dragOverTarget?.threadId === threadId;
  }
}
