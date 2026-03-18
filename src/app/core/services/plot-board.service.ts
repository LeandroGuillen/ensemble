import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PlotBoard, PlotBoardFrontmatter, PlotThread } from '../interfaces/plot-board.interface';
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
      const empty: PlotBoard = { threads: [], rows: [], cells: {} };
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

    const tableContent = parseResult.success && parseResult.data
      ? parseResult.data.content
      : raw;

    const { rows, cells } = this.parseTable(tableContent, threads);

    return { threads, rows, cells };
  }

  private parseTable(
    tableContent: string,
    threads: PlotThread[]
  ): { rows: string[]; cells: Record<string, Record<string, string>> } {
    const rows: string[] = [];
    const cells: Record<string, Record<string, string>> = {};

    const lines = tableContent.split('\n').filter((l) => l.trim().length > 0);

    // Need at least a header row and a separator row
    if (lines.length < 2) return { rows, cells };

    // Parse header row to map column positions to thread IDs
    const headerCells = this.splitTableRow(lines[0]);
    const threadIds: (string | null)[] = headerCells.map((headerName, i) => {
      if (i === 0) return null; // first column is row labels
      const match = threads.find((t) => t.name === headerName);
      return match?.id ?? null;
    });

    // Skip separator row (line index 1), parse data rows
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
    return end.split('|').map((s) => s.trim());
  }

  generateFile(board: PlotBoard): string {
    const frontmatter: PlotBoardFrontmatter = {
      threads: board.threads,
    };

    const tableLines: string[] = [];

    // Header row
    const headerParts = [''].concat(board.threads.map((t) => ` ${t.name} `));
    tableLines.push('|' + headerParts.join('|') + '|');

    // Separator row
    const sepParts = ['---'].concat(board.threads.map(() => '---'));
    tableLines.push('|' + sepParts.join('|') + '|');

    // Data rows
    for (let r = 0; r < board.rows.length; r++) {
      const rowKey = String(r);
      const dataParts = [` ${board.rows[r]} `].concat(
        board.threads.map((t) => {
          const val = board.cells[rowKey]?.[t.id] ?? '';
          return val ? ` ${val} ` : ' ';
        })
      );
      tableLines.push('|' + dataParts.join('|') + '|');
    }

    const tableStr = tableLines.join('\n');
    return MarkdownUtils.generateMarkdown(frontmatter, tableStr);
  }

  generateThreadId(name: string, currentThreads?: PlotThread[]): string {
    const base = slugify(name) || 'thread';
    const existing = (currentThreads ?? this.plotBoardSubject.value?.threads ?? []).map((t) => t.id);
    let id = base;
    let counter = 1;
    while (existing.includes(id)) {
      id = `${base}-${counter++}`;
    }
    return id;
  }
}
