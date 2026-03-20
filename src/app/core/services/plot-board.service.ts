import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PlotBoard, PlotBoardFrontmatter, PlotCellMeta, PlotRow, PlotThread } from '../interfaces/plot-board.interface';
import { MarkdownUtils } from '../utils/markdown.utils';
import { pathJoin } from '../utils/path.utils';
import { nextPlotBoardDuplicateStem, slugify } from '../utils/slug.utils';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';

/** Primary glob for new files; legacy/alternate: `*.plotboard.md` */
export const PLOTBOARD_FILE_GLOB = '*.pinboard.md';
export const PLOTBOARD_ALT_FILE_GLOB = '*.plotboard.md';

/** Empty = create new plot boards at project root */
const DEFAULT_NEW_RELATIVE_DIR = '';

export function plotBoardFileSuffix(filename: string): '.pinboard.md' | '.plotboard.md' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pinboard.md')) return '.pinboard.md';
  if (lower.endsWith('.plotboard.md')) return '.plotboard.md';
  return null;
}

@Injectable({
  providedIn: 'root',
})
export class PlotBoardService {
  private plotBoardSubject = new BehaviorSubject<PlotBoard | null>(null);
  public plotBoard$ = this.plotBoardSubject.asObservable();

  private currentRelativePathSubject = new BehaviorSubject<string | null>(null);
  public currentRelativePath$ = this.currentRelativePathSubject.asObservable();

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private logger: LoggingService
  ) {}

  getPlotBoard(): PlotBoard | null {
    return this.plotBoardSubject.value;
  }

  getCurrentRelativePath(): string | null {
    return this.currentRelativePathSubject.value;
  }

  setCurrentRelativePath(relativePath: string | null): void {
    this.currentRelativePathSubject.next(relativePath);
  }

  normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private getAbsolutePath(relativePath: string): string | null {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) return null;
    return pathJoin(project.path, this.normalizeRelativePath(relativePath));
  }

  /**
   * Recursively find all plot board files (*.pinboard.md and *.plotboard.md).
   */
  async discoverPlotboardFiles(): Promise<string[]> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) return [];

    const [a, b] = await Promise.all([
      this.electronService.readDirectoryRecursive(project.path, PLOTBOARD_FILE_GLOB),
      this.electronService.readDirectoryRecursive(project.path, PLOTBOARD_ALT_FILE_GLOB),
    ]);

    const merged = new Set<string>();
    for (const res of [a, b]) {
      if (res.success && res.files) {
        for (const f of res.files) {
          merged.add(this.normalizeRelativePath(f.relativePath));
        }
      }
    }

    return [...merged].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));
  }

  async loadPlotBoard(relativePath: string | null): Promise<void> {
    this.setCurrentRelativePath(relativePath);

    if (!relativePath) {
      const empty: PlotBoard = { threads: [], rows: [], cells: {}, cellMeta: {} };
      this.plotBoardSubject.next(empty);
      return;
    }

    const filePath = this.getAbsolutePath(relativePath);
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
    const relativePath = this.getCurrentRelativePath();
    if (!relativePath) {
      throw new Error('No plot board file is open');
    }

    const filePath = this.getAbsolutePath(relativePath);
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

  async createPlotBoardFile(nameHint: string): Promise<{ success: boolean; relativePath?: string; error?: string }> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return { success: false, error: 'No project loaded' };
    }

    const base = slugify(nameHint.trim()) || 'plot-board';
    const dirRel = DEFAULT_NEW_RELATIVE_DIR;
    let stem = base;
    let counter = 1;

    const tryPath = (s: string): string =>
      dirRel ? pathJoin(dirRel, `${s}.pinboard.md`) : `${s}.pinboard.md`;

    let relativePath = tryPath(stem);
    let absCheck = await this.electronService.pathJoin(project.path, relativePath);
    while (await this.electronService.fileExists(absCheck)) {
      stem = `${base}-${counter++}`;
      relativePath = tryPath(stem);
      absCheck = await this.electronService.pathJoin(project.path, relativePath);
    }

    if (dirRel) {
      const dirAbs = await this.electronService.pathJoin(project.path, dirRel);
      const mkdir = await this.electronService.createDirectory(dirAbs);
      if (!mkdir.success) {
        return { success: false, error: mkdir.error || 'Could not create folder' };
      }
    }

    const empty: PlotBoard = { threads: [], rows: [], cells: {}, cellMeta: {} };
    const content = this.generateFile(empty);
    const fileAbs = await this.electronService.pathJoin(project.path, relativePath);
    const write = await this.electronService.writeFileAtomic(fileAbs, content);
    if (!write.success) {
      return { success: false, error: write.error || 'Could not create file' };
    }

    return { success: true, relativePath: this.normalizeRelativePath(relativePath) };
  }

  private getAbsolutePathForProject(projectPath: string, relativePath: string): string {
    return pathJoin(projectPath, this.normalizeRelativePath(relativePath));
  }

  async deletePlotBoardFile(relativePath: string): Promise<{ success: boolean; error?: string }> {
    const abs = this.getAbsolutePath(relativePath);
    if (!abs) return { success: false, error: 'No project' };
    return this.electronService.deleteFile(abs);
  }

  /**
   * Copy a plot board file beside the original with an auto-generated stem (increment trailing number or add `-2`).
   */
  async duplicatePlotBoardFile(
    oldRelative: string
  ): Promise<{ success: boolean; newRelative?: string; error?: string }> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return { success: false, error: 'No project loaded' };
    }

    const normOld = this.normalizeRelativePath(oldRelative);
    const parts = normOld.split('/');
    const oldFile = parts.pop()!;
    const parentRel = parts.join('/');

    const suffix = plotBoardFileSuffix(oldFile);
    if (!suffix) {
      return { success: false, error: 'Not a plot board file' };
    }

    const oldStem = oldFile.slice(0, -suffix.length);
    let newStem = nextPlotBoardDuplicateStem(oldStem);
    let newFileName = `${newStem}${suffix}`;
    let newRelative = parentRel ? `${parentRel}/${newFileName}` : newFileName;

    const destAbs = (rel: string) => this.getAbsolutePathForProject(project.path, rel);
    while (await this.electronService.fileExists(destAbs(newRelative))) {
      newStem = nextPlotBoardDuplicateStem(newStem);
      newFileName = `${newStem}${suffix}`;
      newRelative = parentRel ? `${parentRel}/${newFileName}` : newFileName;
    }

    const srcAbs = this.getAbsolutePathForProject(project.path, normOld);
    const result = await this.electronService.copyFile(srcAbs, destAbs(newRelative));
    if (!result.success) {
      return { success: false, error: result.error || 'Duplicate failed' };
    }

    return { success: true, newRelative };
  }

  /**
   * Rename plot board file by changing the filename stem (directory unchanged). newStem must slugify to no spaces.
   */
  async renamePlotBoardFile(
    oldRelative: string,
    newDisplayName: string
  ): Promise<{ success: boolean; newRelative?: string; error?: string }> {
    const project = this.projectService.getCurrentProject();
    if (!project?.path) {
      return { success: false, error: 'No project loaded' };
    }

    const newStem = slugify(newDisplayName.trim());
    if (!newStem) {
      return { success: false, error: 'Invalid name' };
    }

    const normOld = this.normalizeRelativePath(oldRelative);
    const parts = normOld.split('/');
    const oldFile = parts.pop()!;
    const parentRel = parts.join('/');

    const suffix = plotBoardFileSuffix(oldFile);
    if (!suffix) {
      return { success: false, error: 'Not a plot board file' };
    }

    const newFileName = `${newStem}${suffix}`;
    const newRelative = parentRel ? `${parentRel}/${newFileName}` : newFileName;

    if (normOld === newRelative) {
      return { success: true, newRelative };
    }

    const destAbs = this.getAbsolutePathForProject(project.path, newRelative);
    if (await this.electronService.fileExists(destAbs)) {
      return {
        success: false,
        error: `A file already exists at "${newRelative}". Choose a different name.`,
      };
    }

    const srcAbs = this.getAbsolutePathForProject(project.path, normOld);
    const result = await this.electronService.moveFile(srcAbs, destAbs);
    if (!result.success) {
      return { success: false, error: result.error || 'Rename failed' };
    }

    // Keep in sync with disk so saves (including debounced) never recreate the old path.
    const cur = this.getCurrentRelativePath();
    if (cur && this.normalizeRelativePath(cur) === normOld) {
      this.setCurrentRelativePath(this.normalizeRelativePath(newRelative));
    }

    return { success: true, newRelative };
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
