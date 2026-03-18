import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PlotBoard, PlotBoardFrontmatter, PlotCellMeta, PlotRow, PlotThread } from '../interfaces/plot-board.interface';
import { MarkdownUtils } from '../utils/markdown.utils';
import { pathJoin } from '../utils/path.utils';
import { slugify } from '../utils/slug.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

const PLOT_BOARD_FILENAME = 'plot-board.md';

@Injectable({
  providedIn: 'root',
})
export class PlotBoardService {
  private plotBoardSubject = new BehaviorSubject<PlotBoard | null>(null);
  public plotBoard$ = this.plotBoardSubject.asObservable();

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {}

  getPlotBoard(): PlotBoard | null {
    return this.plotBoardSubject.value;
  }

  private getFilePath(): string | null {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) return null;
    return pathJoin(project.path, PLOT_BOARD_FILENAME);
  }

  async loadPlotBoard(): Promise<void> {
    const filePath = this.getFilePath();
    if (!filePath) return;

    const exists = await this.electronService.fileExists(filePath);
    if (!exists) {
      const empty: PlotBoard = { threads: [], rows: [], cells: {}, cellMeta: {} };
      this.plotBoardSubject.next(empty);
      return;
    }

    try {
      const result = await this.electronService.readFile(filePath);
      if (!result.success || !result.content) {
        this.logger.error('Failed to read plot board file', result.error);
        return;
      }

      const plotBoard = this.parseFile(result.content);
      this.plotBoardSubject.next(plotBoard);
    } catch (error) {
      this.logger.error('Failed to load plot board', error);
    }
  }

  async savePlotBoard(board: PlotBoard): Promise<void> {
    const filePath = this.getFilePath();
    if (!filePath) return;

    try {
      const content = this.generateFile(board);
      const writeResult = await this.electronService.writeFileAtomic(filePath, content);
      if (!writeResult.success) {
        throw new Error(writeResult.error);
      }
      this.plotBoardSubject.next(board);
    } catch (error) {
      this.logger.error('Failed to save plot board', error);
      throw error;
    }
  }

  parseFile(raw: string): PlotBoard {
    const parseResult = MarkdownUtils.parseMarkdown<PlotBoardFrontmatter>(raw);

    const threads: PlotThread[] = parseResult.success && parseResult.data?.frontmatter?.threads
      ? parseResult.data.frontmatter.threads
      : [];

    const cellMeta: Record<string, Record<string, PlotCellMeta>> =
      parseResult.success && parseResult.data?.frontmatter?.cellMeta
        ? parseResult.data.frontmatter.cellMeta
        : {};

    const rowsMeta: PlotRow[] | undefined =
      parseResult.success && parseResult.data?.frontmatter?.rows
        ? parseResult.data.frontmatter.rows
        : undefined;

    const tableContent = parseResult.success && parseResult.data
      ? parseResult.data.content
      : raw;

    const { rows: rowNames, cells } = this.parseTable(tableContent, threads);

    const rows: PlotRow[] = rowNames.map((name, i) => {
      if (rowsMeta && rowsMeta[i]) {
        return { name, icon: rowsMeta[i].icon };
      }
      return { name };
    });

    return { threads, rows, cells, cellMeta };
  }

  private parseTable(
    tableContent: string,
    threads: PlotThread[]
  ): { rows: string[]; cells: Record<string, Record<string, string>> } {
    const rows: string[] = [];
    const cells: Record<string, Record<string, string>> = {};

    const lines = tableContent.split('\n').filter((l) => l.trim().length > 0);

    if (lines.length < 2) return { rows, cells };

    const headerCells = this.splitTableRow(lines[0]);
    const threadIds: (string | null)[] = headerCells.map((headerName, i) => {
      if (i === 0) return null;
      const match = threads.find((t) => t.name === headerName);
      return match?.id ?? null;
    });

    for (let i = 2; i < lines.length; i++) {
      const rowCells = this.splitTableRow(lines[i]);
      if (rowCells.length === 0) continue;

      const rowName = rowCells[0];
      rows.push(rowName);
      const rowKey = String(rows.length - 1);
      cells[rowKey] = {};

      for (let col = 1; col < rowCells.length; col++) {
        const threadId = threadIds[col];
        if (threadId && rowCells[col]) {
          cells[rowKey][threadId] = rowCells[col];
        }
      }
    }

    return { rows, cells };
  }

  private splitTableRow(line: string): string[] {
    const trimmed = line.trim();
    const stripped = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const end = stripped.endsWith('|') ? stripped.slice(0, -1) : stripped;
    return end.split('|').map((s) => this.unescapeCell(s.trim()));
  }

  private escapeCell(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>');
  }

  private unescapeCell(value: string): string {
    return value
      .replace(/<br>/g, '\n')
      .replace(/\\\|/g, '|')
      .replace(/\\\\/g, '\\');
  }

  generateFile(board: PlotBoard): string {
    const cleanedMeta = this.cleanCellMeta(board.cellMeta);
    const rowsMeta = this.cleanRowsMeta(board.rows);

    const frontmatter: PlotBoardFrontmatter = {
      threads: board.threads,
      ...(rowsMeta.length > 0 ? { rows: rowsMeta } : {}),
      ...(Object.keys(cleanedMeta).length > 0 ? { cellMeta: cleanedMeta } : {}),
    };

    const tableLines: string[] = [];

    const headerParts = [''].concat(board.threads.map((t) => ` ${this.escapeCell(t.name)} `));
    tableLines.push('|' + headerParts.join('|') + '|');

    const sepParts = ['---'].concat(board.threads.map(() => '---'));
    tableLines.push('|' + sepParts.join('|') + '|');

    for (let r = 0; r < board.rows.length; r++) {
      const rowKey = String(r);
      const dataParts = [` ${this.escapeCell(board.rows[r].name)} `].concat(
        board.threads.map((t) => {
          const val = board.cells[rowKey]?.[t.id] ?? '';
          return val ? ` ${this.escapeCell(val)} ` : ' ';
        })
      );
      tableLines.push('|' + dataParts.join('|') + '|');
    }

    const tableStr = tableLines.join('\n');
    return MarkdownUtils.generateMarkdown(frontmatter, tableStr);
  }

  private cleanCellMeta(
    meta: Record<string, Record<string, PlotCellMeta>>
  ): Record<string, Record<string, PlotCellMeta>> {
    const result: Record<string, Record<string, PlotCellMeta>> = {};
    for (const rowKey of Object.keys(meta)) {
      const row = meta[rowKey];
      const cleanedRow: Record<string, PlotCellMeta> = {};
      for (const threadId of Object.keys(row)) {
        const entry = row[threadId];
        if (entry.icon || entry.color) {
          cleanedRow[threadId] = entry;
        }
      }
      if (Object.keys(cleanedRow).length > 0) {
        result[rowKey] = cleanedRow;
      }
    }
    return result;
  }

  private cleanRowsMeta(rows: PlotRow[]): PlotRow[] {
    const hasAnyIcon = rows.some((r) => r.icon);
    if (!hasAnyIcon) return [];
    return rows.map((r) => (r.icon ? { name: r.name, icon: r.icon } : { name: r.name }));
  }

  generateThreadId(name: string, currentThreads?: PlotThread[], excludeId?: string): string {
    const base = slugify(name) || 'thread';
    const existing = (currentThreads ?? this.plotBoardSubject.value?.threads ?? [])
      .filter((t) => t.id !== excludeId)
      .map((t) => t.id);
    let id = base;
    let counter = 1;
    while (existing.includes(id)) {
      id = `${base}-${counter++}`;
    }
    return id;
  }

  renameThreadId(
    board: PlotBoard,
    oldId: string,
    newId: string
  ): void {
    if (oldId === newId) return;

    for (const rowKey of Object.keys(board.cells)) {
      if (board.cells[rowKey][oldId] !== undefined) {
        board.cells[rowKey][newId] = board.cells[rowKey][oldId];
        delete board.cells[rowKey][oldId];
      }
    }

    for (const rowKey of Object.keys(board.cellMeta)) {
      if (board.cellMeta[rowKey][oldId] !== undefined) {
        board.cellMeta[rowKey][newId] = board.cellMeta[rowKey][oldId];
        delete board.cellMeta[rowKey][oldId];
      }
    }
  }
}
