import { TestBed } from '@angular/core/testing';
import { BackupService } from './backup.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

describe('BackupService', () => {
  let service: BackupService;
  let electron: jasmine.SpyObj<ElectronService>;
  let projectService: jasmine.SpyObj<ProjectService>;

  function makeProject(settings: Record<string, unknown> = {}, path = '/w/lantern-coast') {
    return {
      path,
      metadata: { settings: { backup: settings } },
    } as any;
  }

  beforeEach(() => {
    electron = jasmine.createSpyObj('ElectronService', [
      'createBackupSnapshot',
      'restoreBackupSnapshot',
      'listBackupSnapshots',
      'pruneBackupSnapshots',
    ]);
    projectService = jasmine.createSpyObj('ProjectService', [
      'getCurrentProject',
      'updateMetadata',
      'loadProject',
    ]);
    projectService.getCurrentProject.and.returnValue(makeProject());
    projectService.updateMetadata.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        { provide: ElectronService, useValue: electron },
        { provide: ProjectService, useValue: projectService },
      ],
    });
    service = TestBed.inject(BackupService);
  });

  it('reads the project backup settings', () => {
    projectService.getCurrentProject.and.returnValue(makeProject({ keepAutomatic: 3 }));
    expect(service.settings).toEqual({ keepAutomatic: 3 });
  });

  it('uses the chosen backup folder when set', () => {
    projectService.getCurrentProject.and.returnValue(makeProject({ backupFolder: '/w/backups' }));
    expect(service.backupDir).toBe('/w/backups');
  });

  it('defaults the backup folder to excluded project-local snapshots', () => {
    projectService.getCurrentProject.and.returnValue(makeProject({}, '/w/lantern-coast'));
    expect(service.backupDir).toBe('/w/lantern-coast/.ensemble-backup/snapshots');
  });

  it('createSnapshot zips into the backup folder and returns the snapshot', async () => {
    electron.createBackupSnapshot.and.resolveTo({ success: true, snapshot: { path: '/b/a.zip', name: 'a.zip', size: 10, fileCount: 2, createdAt: 'x', automatic: false } });
    const snapshot = await service.createSnapshot();
    expect(electron.createBackupSnapshot).toHaveBeenCalledWith('/w/lantern-coast', '/w/lantern-coast/.ensemble-backup/snapshots');
    expect(snapshot.name).toBe('a.zip');
  });

  it('createSnapshot throws a helpful error when IPC fails', async () => {
    electron.createBackupSnapshot.and.resolveTo({ success: false, error: 'boom' });
    await expectAsync(service.createSnapshot()).toBeRejectedWithError(/boom/);
  });

  it('restoreSnapshot returns the new folder so the caller can open it', async () => {
    electron.restoreBackupSnapshot.and.resolveTo({ success: true, folderPath: '/w/x-restored', entryCount: 4, name: 'x-restored' });
    const result = await service.restoreSnapshot('/b/a.zip');
    expect(electron.restoreBackupSnapshot).toHaveBeenCalledWith('/b/a.zip', '/w', undefined);
    expect(result.folderPath).toBe('/w/x-restored');
  });

  it('listSnapshots returns the snapshots', async () => {
    electron.listBackupSnapshots.and.resolveTo({ success: true, snapshots: [] });
    await expectAsync(service.listSnapshots()).toBeResolvedTo([]);
    expect(electron.listBackupSnapshots as jasmine.Spy).toHaveBeenCalledWith('/w/lantern-coast/.ensemble-backup/snapshots', '/w/lantern-coast');
  });

  it('prune returns removed and kept names', async () => {
    electron.pruneBackupSnapshots.and.resolveTo({ success: true, removed: ['a'], kept: ['b'] });
    const result = await service.prune('/b', 1);
    expect(result).toEqual({ removed: ['a'], kept: ['b'] });
    expect(electron.pruneBackupSnapshots as jasmine.Spy).toHaveBeenCalledWith('/b', 1, '/w/lantern-coast');
  });

  it('updateSettings merges into settings.backup and persists metadata', async () => {
    projectService.getCurrentProject.and.returnValue(makeProject({ keepAutomatic: 3 }));
    await service.updateSettings({ backupFolder: '/w/backups' });
    const updates = projectService.updateMetadata.calls.mostRecent().args[0] as any;
    expect(updates.settings.backup).toEqual({ keepAutomatic: 3, backupFolder: '/w/backups' });
  });
});
