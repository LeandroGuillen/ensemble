/** A project backup snapshot: a timestamped zip of the project folder. */
export interface BackupSnapshot {
  /** Absolute path of the zip. */
  path: string;
  /** File name of the zip. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** Number of project files captured. */
  fileCount: number;
  /** Entries omitted from this snapshot, with project-relative paths. */
  skipped?: { path: string; reason: string }[];
  /** ISO timestamp of the snapshot. */
  createdAt: string;
  /** Whether this is an automatic (retained) snapshot. */
  automatic: boolean;
  /** Only the text files a migration can rewrite (no images); set on creation, not when listing. */
  dataOnly?: boolean;
}

/** Result of restoring a snapshot into a fresh folder. */
export interface BackupRestoreResult {
  /** Absolute path of the newly created restored folder. */
  folderPath: string;
  /** Number of entries extracted. */
  entryCount: number;
  /** Name of the restored folder. */
  name: string;
}

/** Per-project backup settings, stored in `ProjectSettings.backup`. */
export interface BackupSettings {
  /** Take an automatic snapshot before a storage migration on project open. */
  autoBeforeMigration?: boolean;
  /** How many automatic snapshots to keep (retention). */
  keepAutomatic?: number;
  /** Folder for snapshots; defaults to a sibling `ensemble-backups` folder. */
  backupFolder?: string;
}
