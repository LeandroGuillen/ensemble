/**
 * Shared IPC channel registry.
 *
 * Single source of truth: `ipc-channels.json` at the project root. Both the
 * Electron main process (`main.js`, via `require`) and the Angular renderer
 * (via this typed wrapper) consume the same JSON so the channel strings can
 * never drift between the two sides.
 *
 * To add a channel: append it to `ipc-channels.json` and to the `IpcChannels`
 * interface below.
 */

import channels from '../../../../ipc-channels.json';

export interface IpcChannels {
  readonly setBrowserNavigationInterception: string;
  readonly browserNavigationCommand: string;

  readonly fileChanged: string;
  readonly updateStatus: string;

  readonly selectFolder: string;
  readonly selectImage: string;
  readonly selectImages: string;
  readonly getVersion: string;

  readonly getRecentProjects: string;
  readonly saveRecentProjects: string;
  readonly setWorkFolder: string;

  readonly createDirectory: string;
  readonly fileExists: string;
  readonly isDirectory: string;
  readonly readFile: string;
  readonly writeFile: string;
  readonly writeFileAtomic: string;

  readonly deleteFile: string;
  readonly listDirectory: string;
  readonly copyFile: string;
  readonly moveFile: string;
  readonly getFileStats: string;
  readonly getImageDataUrl: string;
  readonly moveDirectory: string;
  readonly deleteDirectoryRecursive: string;
  readonly copyDirectoryRecursive: string;
  readonly readDirectoryFiles: string;
  readonly readDirectoryRecursive: string;

  readonly startFileWatcher: string;
  readonly stopFileWatcher: string;

  readonly aiRequest: string;
  readonly downloadImage: string;
  readonly saveBase64Image: string;

  readonly openFileInEditor: string;
  readonly showItemInFolder: string;
  readonly openPath: string;

  readonly checkForUpdates: string;
  readonly downloadUpdate: string;
  readonly getUpdateStatus: string;
  readonly quitAndInstall: string;
  readonly copyUpdateToDownloads: string;
  readonly openUpdateFolder: string;
}

export const IpcChannels: IpcChannels = channels as IpcChannels;