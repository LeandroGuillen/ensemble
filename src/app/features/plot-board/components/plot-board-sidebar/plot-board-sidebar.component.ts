import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PlotBoardService } from '../../../../core/services/plot-board.service';
import { ProjectService } from '../../../../core/services/project.service';
import { LoggingService } from '../../../../core/services/logging.service';
import { pathBasename } from '../../../../core/utils/path.utils';

@Component({
  selector: 'app-plot-board-sidebar',
  imports: [FormsModule, RouterLink],
  templateUrl: './plot-board-sidebar.component.html',
  styleUrls: ['./plot-board-sidebar.component.scss'],
})
export class PlotBoardSidebarComponent implements OnInit {
  private readonly plotBoardService = inject(PlotBoardService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  @Input() open = true;
  @Input() currentPath: string | null = null;
  /** When true, auto-save is suspended while deleting the open board. */
  @Input() suspendAutoSave = false;

  @Output() openChange = new EventEmitter<boolean>();
  @Output() pathsChange = new EventEmitter<string[]>();
  @Output() suspendAutoSaveChange = new EventEmitter<boolean>();
  @Output() beforeNavigate = new EventEmitter<void>();

  plotboardPaths: string[] = [];
  duplicateError = '';
  renameError = '';
  showRenameDialog = false;
  renameValue = '';
  showNewPlotBoardDialog = false;
  newPlotBoardName = '';
  newPlotBoardError = '';
  showDeletePlotBoardDialog = false;
  deletePlotBoardError = '';
  renameTargetPath: string | null = null;
  deleteTargetPath: string | null = null;

  ngOnInit(): void {
    void this.refreshList();
  }

  async refreshList(): Promise<string[]> {
    this.plotboardPaths = await this.plotBoardService.discoverPlotboardFiles();
    this.pathsChange.emit(this.plotboardPaths);
    return this.plotboardPaths;
  }

  toggleSidebar(): void {
    this.open = !this.open;
    this.openChange.emit(this.open);
    try {
      localStorage.setItem('ensemble.plotBoard.sidebarOpen', this.open ? '1' : '0');
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

  routerLinkForPlotboard(relativePath: string): string[] {
    return ['/plot-board', ...relativePath.split('/').filter((s) => s.length > 0)];
  }

  isCurrentPath(relativePath: string): boolean {
    if (!this.currentPath) return false;
    return (
      this.plotBoardService.normalizeRelativePath(this.currentPath) ===
      this.plotBoardService.normalizeRelativePath(relativePath)
    );
  }

  get deleteDialogPath(): string | null {
    return this.deleteTargetPath;
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
    this.beforeNavigate.emit();
    const result = await this.plotBoardService.createPlotBoardFile(trimmed);
    if (!result.success || !result.relativePath) {
      this.newPlotBoardError = result.error || 'Could not create plot board';
      return;
    }
    this.showNewPlotBoardDialog = false;
    await this.router.navigate(this.routerLinkForPlotboard(result.relativePath));
    await this.refreshList();
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
      !!cur &&
      this.plotBoardService.normalizeRelativePath(p) === this.plotBoardService.normalizeRelativePath(cur);
    if (isDeletingOpen) {
      this.suspendAutoSaveChange.emit(true);
    }
    if (isDeletingOpen) {
      this.beforeNavigate.emit();
    }
    const del = await this.plotBoardService.deletePlotBoardFile(p);
    if (!del.success) {
      this.deletePlotBoardError = del.error || 'Could not delete file';
      if (isDeletingOpen) this.suspendAutoSaveChange.emit(false);
      return;
    }
    this.showDeletePlotBoardDialog = false;
    this.deleteTargetPath = null;
    await this.refreshList();
    if (isDeletingOpen) {
      const next = this.plotboardPaths[0] ?? null;
      if (next) {
        await this.router.navigate(this.routerLinkForPlotboard(next));
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
      this.plotBoardService.normalizeRelativePath(target) ===
        this.plotBoardService.normalizeRelativePath(current);
    if (isRenamingOpen) {
      this.beforeNavigate.emit();
    }
    const result = await this.plotBoardService.renamePlotBoardFile(target, this.renameValue);
    if (!result.success) {
      this.renameError = result.error || 'Rename failed';
      return;
    }
    this.renameError = '';
    this.showRenameDialog = false;
    this.renameTargetPath = null;
    await this.refreshList();
    if (result.newRelative && isRenamingOpen) {
      await this.router.navigate(this.routerLinkForPlotboard(result.newRelative), { replaceUrl: true });
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
      this.beforeNavigate.emit();
    }
    const result = await this.plotBoardService.duplicatePlotBoardFile(norm);
    if (!result.success || !result.newRelative) {
      this.duplicateError = result.error || 'Could not duplicate file';
      return;
    }
    await this.refreshList();
    await this.router.navigate(this.routerLinkForPlotboard(result.newRelative));
    await this.projectService.saveLastPlotboardPath(result.newRelative);
  }

  modalsOpen(): boolean {
    return this.showRenameDialog || this.showNewPlotBoardDialog || this.showDeletePlotBoardDialog;
  }
}
