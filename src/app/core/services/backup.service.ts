import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { requireProject } from '../utils/project.utils';
import {
  BackupSnapshot,
  BackupRestoreResult,
  BackupSettings,
} from '../interfaces/backup.interface';

/** Assert a value is present, throwing a helpful message when it is not. */
function required<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

/**
 * Renderer-side project backup/restore.
 *
 * Wraps the main-process backup IPC and persists the per-project backup
 * settings (automatic pre-migration snapshots, retention, backup folder) in
 * `ProjectSettings.backup`.
 */
@Injectable({
  providedIn: 'root',
})
export class BackupService {
  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService
  ) {}

  /** Current project's backup settings (never null). */
  get settings(): BackupSettings {
    return this.projectService.getCurrentProject()?.metadata.settings.backup ?? {};
  }

  /** Absolute path of the current project, or null when none is open. */
  get projectPath(): string | null {
    return this.projectService.getCurrentProject()?.path ?? null;
  }

  /**
   * Effective backup folder: the chosen folder, or excluded project-local snapshots.
   */
  get backupDir(): string | null {
    const projectPath = this.projectPath;
    if (!projectPath) return null;
    if (this.settings.backupFolder) return this.settings.backupFolder;
    return this.join(this.join(projectPath, '.ensemble-backup'), 'snapshots');
  }

  /** Persist backup settings for the current project. */
  async updateSettings(backup: BackupSettings): Promise<void> {
    const project = requireProject(this.projectService.getCurrentProject());
    const updatedMetadata = {
      ...project.metadata,
      settings: {
        ...project.metadata.settings,
        backup: { ...project.metadata.settings.backup, ...backup },
      },
    };
    await this.projectService.updateMetadata(updatedMetadata);
  }

  /** Create a zip snapshot of the project into `destDir` (defaults to the backup folder). */
  async createSnapshot(destDir?: string): Promise<BackupSnapshot> {
    const projectPath = required(this.projectPath, 'No project is open');
    const target = destDir ?? required(this.backupDir, 'No backup folder');
    const result = await this.electronService.createBackupSnapshot(projectPath, target);
    if (!result.success || !result.snapshot) {
      throw new Error(result.error || 'Could not create the snapshot');
    }
    return result.snapshot;
  }

  /**
   * Restore a snapshot into a brand-new folder (never over the live project) and
   * return its path so the caller can open it.
   */
  async restoreSnapshot(
    zipPath: string,
    destParentDir?: string,
    restoredName?: string
  ): Promise<BackupRestoreResult> {
    const projectPath = this.projectPath;
    const parent = destParentDir ?? (projectPath ? this.parentOf(projectPath) : null);
    const name = restoredName;
    const targetParent = required(parent, 'No project is open');
    const result = await this.electronService.restoreBackupSnapshot(zipPath, targetParent, name);
    if (!result.success || !result.folderPath) {
      throw new Error(result.error || 'Could not restore the snapshot');
    }
    return { folderPath: result.folderPath, entryCount: result.entryCount ?? 0, name: result.name ?? '' };
  }

  /** List snapshots in the backup folder (or a given folder), newest first. */
  async listSnapshots(dir?: string): Promise<BackupSnapshot[]> {
    const target = dir ?? required(this.backupDir, 'No backup folder');
    const result = await this.electronService.listBackupSnapshots(target, required(this.projectPath, 'No project is open'));
    if (!result.success) {
      throw new Error(result.error || 'Could not list snapshots');
    }
    return result.snapshots ?? [];
  }

  /** Keep only the newest `keepN` automatic snapshots in `dir`. */
  async prune(dir: string, keepN: number): Promise<{ removed: string[]; kept: string[] }> {
    const result = await this.electronService.pruneBackupSnapshots(dir, keepN, required(this.projectPath, 'No project is open'));
    if (!result.success) {
      throw new Error(result.error || 'Could not prune snapshots');
    }
    return { removed: result.removed ?? [], kept: result.kept ?? [] };
  }

  // Minimal path helpers so the service has no Node `path` dependency in the renderer.
  private parentOf(p: string): string {
    const normalized = p.replace(/[\\/]+$/, '');
    const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    return idx > 0 ? normalized.slice(0, idx) : normalized;
  }

  private join(a: string, b: string): string {
    const sep = a.includes('\\') && !a.includes('/') ? '\\' : '/';
    return a.endsWith('/') || a.endsWith('\\') ? a + b : a + sep + b;
  }
}
