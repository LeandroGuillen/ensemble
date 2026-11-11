import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackupDestinationReadOnlyError, BackupService } from '../../core/services/backup.service';
import { ElectronService } from '../../core/services/electron.service';
import { ProjectService } from '../../core/services/project.service';
import { NotificationService } from '../../core/services/notification.service';
import { BackupSnapshot } from '../../core/interfaces/backup.interface';
import type { SettingsSectionId } from '../settings/settings-section';
import { SettingsSearchableDirective } from '../settings/settings-searchable.directive';

/** Default retention when the project has not chosen one. */
const DEFAULT_KEEP = 5;

@Component({
  selector: 'app-backup-settings',
  imports: [FormsModule, SettingsSearchableDirective],
  templateUrl: './backup-settings.component.html',
  styleUrls: ['./backup-settings.component.scss'],
})
export class BackupSettingsComponent implements OnInit {
  /** Which settings panel section to render (driven by the parent Settings page). */
  @Input() activeSection: SettingsSectionId = 'backup';

  snapshots: BackupSnapshot[] = [];
  legacySnapshots: BackupSnapshot[] = [];
  lastResult: BackupSnapshot | null = null;
  creating = false;
  destinationError = '';
  sessionBackupFolder = '';
  restoring = false;
  loading = false;

  autoBeforeMigration = true;
  keepAutomatic = DEFAULT_KEEP;
  backupFolder = '';

  constructor(
    private backupService: BackupService,
    private electronService: ElectronService,
    private projectService: ProjectService,
    private notifications: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadSettings();
    void this.refresh();
  }

  /** The folder snapshots go to (chosen or project-local default). */
  get effectiveBackupDir(): string {
    return this.sessionBackupFolder || this.backupService.backupDir || '';
  }

  private loadSettings(): void {
    const settings = this.backupService.settings;
    this.autoBeforeMigration = settings.autoBeforeMigration !== false;
    this.keepAutomatic = typeof settings.keepAutomatic === 'number' ? settings.keepAutomatic : DEFAULT_KEEP;
    this.backupFolder = settings.backupFolder ?? '';
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      const snapshots = await this.backupService.listSnapshots(this.sessionBackupFolder || undefined);
      this.snapshots = snapshots.filter(snapshot => !snapshot.legacy);
      this.legacySnapshots = snapshots.filter(snapshot => snapshot.legacy);
    } catch {
      this.snapshots = [];
      this.legacySnapshots = [];
    } finally {
      this.loading = false;
    }
  }

  async createSnapshot(): Promise<void> {
    this.creating = true;
    this.destinationError = '';
    try {
      const snapshot = await this.backupService.createSnapshot(this.sessionBackupFolder || undefined);
      this.lastResult = snapshot;
      if (snapshot.skipped?.length) {
        const count = snapshot.skipped.length;
        this.notifications.showError(
          `Snapshot created, but ${count} ${count === 1 ? 'item was' : 'items were'} skipped; see Settings → Backup for the list.`
        );
      } else {
        this.notifications.showSuccess(
          `Snapshot created: ${snapshot.name} (${this.formatSize(snapshot.size)}).`
        );
      }
      await this.refresh();
    } catch (error) {
      if (error instanceof BackupDestinationReadOnlyError) {
        this.destinationError = error.message;
        this.lastResult = null;
      } else {
        this.notifications.showError(`Couldn't create the snapshot: ${(error as Error).message}`);
      }
    } finally {
      this.creating = false;
    }
  }

  async restore(snapshot: BackupSnapshot): Promise<void> {
    this.restoring = true;
    try {
      const result = await this.backupService.restoreSnapshot(snapshot.path);
      this.notifications.showSuccess(`Restored to a new copy. Opening ${result.name}.`);
      await this.projectService.loadProject(result.folderPath);
    } catch (error) {
      this.notifications.showError(`Couldn't restore the snapshot: ${(error as Error).message}`);
    } finally {
      this.restoring = false;
    }
  }

  async chooseSnapshotFolder(): Promise<void> {
    const folder = await this.electronService.selectFolder();
    if (!folder) return;
    // The project may not allow ensemble.json writes. Keep this choice in the
    // open panel and retry directly, without making the backup depend on a save.
    this.sessionBackupFolder = folder;
    this.backupFolder = folder;
    await this.createSnapshot();
  }

  async chooseBackupFolder(): Promise<void> {
    if (this.sessionBackupFolder || this.destinationError) {
      await this.chooseSnapshotFolder();
      return;
    }
    const folder = await this.electronService.selectFolder();
    if (!folder) {
      return;
    }
    await this.backupService.updateSettings({ backupFolder: folder });
    this.backupFolder = folder;
    await this.refresh();
  }

  async onAutoChange(): Promise<void> {
    await this.backupService.updateSettings({ autoBeforeMigration: this.autoBeforeMigration });
  }

  async onKeepChange(): Promise<void> {
    const keep = Math.max(1, Math.floor(Number(this.keepAutomatic) || DEFAULT_KEEP));
    this.keepAutomatic = keep;
    await this.backupService.updateSettings({ keepAutomatic: keep });
    await this.refresh();
  }

  formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }
}
