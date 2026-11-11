import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupSettingsComponent } from './backup-settings.component';
import { BackupService } from '../../core/services/backup.service';
import { ElectronService } from '../../core/services/electron.service';
import { ProjectService } from '../../core/services/project.service';
import { NotificationService } from '../../core/services/notification.service';

describe('BackupSettingsComponent', () => {
  let fixture: ComponentFixture<BackupSettingsComponent>;
  let backupService: jasmine.SpyObj<BackupService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let projectService: jasmine.SpyObj<ProjectService>;

  const snapshot = {
    path: '/b/ensemble-backup-1.zip',
    name: 'ensemble-backup-1.zip',
    size: 2048,
    fileCount: 5,
    createdAt: '2026-11-01T00:00:00.000Z',
    automatic: false,
  };

  beforeEach(async () => {
    backupService = jasmine.createSpyObj<BackupService>(
      'BackupService',
      ['createSnapshot', 'restoreSnapshot', 'listSnapshots', 'prune', 'updateSettings']
    );
    Object.defineProperty(backupService, 'settings', { get: () => ({ keepAutomatic: 5 }) });
    Object.defineProperty(backupService, 'backupDir', { get: () => '/w/ensemble-backups' });
    backupService.listSnapshots.and.resolveTo([snapshot]);
    backupService.createSnapshot.and.resolveTo(snapshot);
    backupService.restoreSnapshot.and.resolveTo({ folderPath: '/w/restored', entryCount: 5, name: 'restored' });

    notifications = jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError']);
    projectService = jasmine.createSpyObj('ProjectService', ['loadProject']);
    projectService.loadProject.and.resolveTo(null as any);

    await TestBed.configureTestingModule({
      imports: [BackupSettingsComponent],
      providers: [
        { provide: BackupService, useValue: backupService },
        { provide: ElectronService, useValue: jasmine.createSpyObj('ElectronService', ['selectFolder']) },
        { provide: ProjectService, useValue: projectService },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('separates older snapshots, labels their project, and offers only restore', async () => {
    const older = { ...snapshot, path: '/old/legacy.zip', name: 'legacy.zip', legacy: true, legacyProjectName: 'Old Novel' };
    backupService.listSnapshots.and.resolveTo([snapshot, older]);
    await fixture.componentInstance.refresh();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const section = fixture.nativeElement.querySelector('.older-snapshots');
    expect(section?.textContent).toContain('Older snapshots (project not recorded)');
    expect(section?.textContent).toContain('Old Novel');
    expect(fixture.nativeElement.querySelectorAll('.snapshot-row').length).toBe(2);
    const buttons = section?.querySelectorAll('button');
    expect(buttons?.length).toBe(1);
    buttons?.[0].click();
    await fixture.whenStable();
    expect(backupService.restoreSnapshot).toHaveBeenCalledWith(older.path);
    expect(backupService.prune).not.toHaveBeenCalled();
  });

  it('lists the snapshots on load', () => {
    const rows = fixture.nativeElement.querySelectorAll('.snapshot-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('ensemble-backup-1.zip');
  });

  it('create snapshot runs the service and reports the result', async () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.form-section button');
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(backupService.createSnapshot).toHaveBeenCalled();
    expect(notifications.showSuccess).toHaveBeenCalled();
    const result = fixture.nativeElement.querySelector('.snapshot-result');
    expect(result).toBeTruthy();
    expect(result.textContent).toContain('2.0 KB');
  });

  for (const count of [1, 3]) {
    it(`shows ${count} skipped item(s) with reasons in the panel and a short toast`, async () => {
      const skipped = [
        { path: 'characters/ilse', reason: 'Broken link' },
        { path: 'references/loop', reason: 'Link loop' },
        { path: 'notes/locked.md', reason: "Can't read (permission denied)" },
      ].slice(0, count);
      backupService.createSnapshot.and.resolveTo({ ...snapshot, skipped });
      fixture.nativeElement.querySelector('.form-section button').click();
      await fixture.whenStable();
      fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector('.snapshot-result');
      expect(panel.querySelector('[role="alert"]').textContent.trim())
        .toBe(`${count} ${count === 1 ? 'item' : 'items'} skipped`);
      expect(Array.from(panel.querySelectorAll('li'), (item: any) => item.textContent.trim()))
        .toEqual(skipped.map(item => `${item.path}: ${item.reason}`));
      expect(panel.classList.contains('success')).toBeFalse();
      expect(notifications.showError).toHaveBeenCalledOnceWith(
        `Snapshot created, but ${count} ${count === 1 ? 'item was' : 'items were'} skipped; see Settings → Backup for the list.`
      );
      expect(notifications.showSuccess).not.toHaveBeenCalled();
    });
  }

  it('restore opens a copy through ProjectService', async () => {
    const restoreButton: HTMLButtonElement = fixture.nativeElement.querySelector('.snapshot-row button');
    restoreButton.click();
    await fixture.whenStable();
    expect(backupService.restoreSnapshot).toHaveBeenCalledWith(snapshot.path);
    expect(projectService.loadProject).toHaveBeenCalledWith('/w/restored');
    expect(notifications.showSuccess).toHaveBeenCalled();
  });
});
