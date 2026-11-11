import { TestBed } from '@angular/core/testing';
import { ProjectHealthService } from './project-health.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { CastService } from './cast.service';
import { ProjectService } from './project.service';
import { MetadataService } from './metadata.service';
import { PlotBoardService } from './plot-board.service';
import { ElectronService } from './electron.service';
import { ModalService } from './modal.service';
import { NotificationService } from './notification.service';
import { HealthFinding } from '../utils/project-health.utils';

describe('ProjectHealthService', () => {
  let service: ProjectHealthService;
  let project: any;
  let projects: any;
  let electron: any;
  let modal: any;
  let casts: any;
  let houses: any;
  let characters: any;
  let notifications: any;
  const finding = (): HealthFinding => ({ name: 'Cast', content: '', route: ['/cast', 'cast'],
    group: 'Orphaned IDs', message: 'Members: missing ID gone',
    fix: { kind: 'cast', owner: 'cast', field: 'Members', missing: 'gone' } });

  beforeEach(() => {
    project = { path: '/throwaway', metadata: { settings: {}, books: [], pinboards: [] } };
    projects = { getCurrentProject: () => project, updatePinboardById: jasmine.createSpy().and.resolveTo(),
      getCastsFolderPath: () => '/throwaway/casts' };
    electron = { fileExists: jasmine.createSpy().and.resolveTo(false), readFile: jasmine.createSpy(),
      writeFileAtomic: jasmine.createSpy().and.resolveTo({ success: true }), createDirectory: jasmine.createSpy() };
    notifications = { showUndo: jasmine.createSpy(), showError: jasmine.createSpy() };
    modal = { confirm: jasmine.createSpy().and.resolveTo(false) };
    casts = { readHealthSnapshot: jasmine.createSpy().and.resolveTo([{ id: 'cast', name: 'Cast', characterIds: ['gone'] }]),
      removeOrphanedId: jasmine.createSpy().and.resolveTo(), loadCasts: jasmine.createSpy() };
    houses = { readHealthSnapshot: jasmine.createSpy().and.resolveTo([]), removeOrphanedId: jasmine.createSpy(), loadHouses: jasmine.createSpy() };
    characters = { getReferenceCharactersSnapshot: () => [], getDraftsSnapshot: () => [], loadCharacters: jasmine.createSpy() };
    characters.readHealthSnapshot = async () => [...characters.getReferenceCharactersSnapshot(), ...characters.getDraftsSnapshot()];
    TestBed.configureTestingModule({ providers: [ProjectHealthService,
      { provide: ProjectService, useValue: projects }, { provide: ElectronService, useValue: electron },
      { provide: ModalService, useValue: modal }, { provide: NotificationService, useValue: notifications }, { provide: CastService, useValue: casts },
      { provide: HouseService, useValue: houses }, { provide: CharacterService, useValue: characters },
      { provide: LocationService, useValue: { readHealthSnapshot: async () => [] } },
      { provide: MetadataService, useValue: {} },
      { provide: PlotBoardService, useValue: { discoverPlotboardFiles: async () => [] } },
    ] });
    service = TestBed.inject(ProjectHealthService);
  });

  it('scans without writes or invoking loaders that perform migrations', async () => {
    const results = await service.scan();
    expect(results.length).toBe(1);
    expect(results[0].route).toEqual(['/cast', 'cast']);
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
    expect(electron.createDirectory).not.toHaveBeenCalled();
    expect(casts.loadCasts).not.toHaveBeenCalled();
    expect(houses.loadHouses).not.toHaveBeenCalled();
    expect(characters.loadCharacters).not.toHaveBeenCalled();
  });

  it('does not write until confirmation and preserves the source when cancelled', async () => {
    expect(await service.repair(finding())).toBeFalse();
    expect(modal.confirm).toHaveBeenCalled();
    expect(casts.removeOrphanedId).not.toHaveBeenCalled();
    modal.confirm.and.resolveTo(true);
    expect(await service.repair(finding())).toBeTrue();
    expect(casts.removeOrphanedId).toHaveBeenCalledOnceWith('cast', 'Members', 'gone');
  });

  it('rechecks after confirmation and skips a target restored while the dialog was open', async () => {
    modal.confirm.and.callFake(async () => { casts.readHealthSnapshot.and.resolveTo([]); return true; });
    expect(await service.repair(finding())).toBeFalse();
    expect(casts.removeOrphanedId).not.toHaveBeenCalled();
  });

  it('refuses to repair after a project switch', async () => {
    modal.confirm.and.callFake(async () => { project = { ...project, path: '/other' }; return true; });
    await expectAsync(service.repair(finding())).toBeRejectedWithError(/project changed/i);
    expect(casts.removeOrphanedId).not.toHaveBeenCalled();
  });

  it('removes only a broken edge, preserving healthy nodes and edges', async () => {
    modal.confirm.and.resolveTo(true);
    const nodes = [{ id: 'alive' }];
    project.metadata.pinboards = [{ id: 'board', name: 'Board', nodes,
      edges: [{ id: 'bad', source: 'alive', target: 'gone' }, { id: 'good', source: 'alive', target: 'alive' }] }];
    characters.getReferenceCharactersSnapshot = () => [{ id: 'alive', name: 'Alive', relativePath: 'alive.md', content: '', books: [] }];
    const item = (await service.scan()).find(result => result.fix?.field === 'Edge:bad')!;
    expect(await service.repair(item)).toBeTrue();
    expect(projects.updatePinboardById).toHaveBeenCalledOnceWith('board', { nodes,
      edges: [{ id: 'good', source: 'alive', target: 'alive' }] });
  });

  it('reports dangling chapter PoVs and removes only their lines after confirmation', async () => {
    project.metadata.books = [{ id: 'book', name: 'Book', plan: { path: 'book.md' } }];
    const content = '# Part\n## 01 - Beginning\nPoV: gone Old Name\nWhen: 320\nKeep these notes.\n';
    electron.readFile.and.resolveTo({ success: true, content });
    modal.confirm.and.resolveTo(true);
    const item = (await service.scan()).find(result => result.fix?.kind === 'plan')!;
    expect(item).toBeDefined();
    expect(await service.repair(item)).toBeTrue();
    expect(electron.writeFileAtomic).toHaveBeenCalledOnceWith('/throwaway/book.md',
      '# Part\n## 01 - Beginning\nWhen: 320\nKeep these notes.\n');
  });

  describe('plan repair confirmation and Undo', () => {
    const original = '# Part\r\n## 01 - Beginning\r\n  PoV: gone Ghost Teller  \r\nPoV: alive Living Teller\r\nWhen: 320\r\nNotes with café.\r\n## 02 - End\nPoV: gone Another Name';
    let disk: string;
    let item: HealthFinding;

    beforeEach(async () => {
      disk = original;
      project.metadata.books = [{ id: 'book', name: 'Book', plan: { path: 'book.md' } }];
      characters.getReferenceCharactersSnapshot = () => [{ id: 'alive', name: 'Living Teller', relativePath: 'alive.md', content: '', books: [] }];
      electron.readFile.and.callFake(async () => ({ success: true, content: disk }));
      electron.writeFileAtomic.and.callFake(async (_path: string, content: string) => {
        disk = content;
        return { success: true };
      });
      modal.confirm.and.resolveTo(true);
      item = (await service.scan()).find(result => result.fix?.kind === 'plan')!;
    });

    it('quotes every full line being deleted, including typed names, even when cancelled', async () => {
      modal.confirm.and.resolveTo(false);
      expect(await service.repair(item)).toBeFalse();
      const message = modal.confirm.calls.mostRecent().args[0];
      expect(message).toContain('“  PoV: gone Ghost Teller  ”');
      expect(message).toContain('“PoV: gone Another Name”');
      expect(message).toContain('entire');
      expect(message).not.toContain('PoV: alive');
      expect(electron.writeFileAtomic).not.toHaveBeenCalled();
      expect(notifications.showUndo).not.toHaveBeenCalled();
    });

    it('restores the plan byte-for-byte with Undo, including mixed newlines and no final newline', async () => {
      expect(await service.repair(item)).toBeTrue();
      expect(disk).toBe('# Part\r\n## 01 - Beginning\r\nPoV: alive Living Teller\r\nWhen: 320\r\nNotes with café.\r\n## 02 - End\n');
      expect(notifications.showUndo).toHaveBeenCalledOnceWith(jasmine.stringContaining('Book'), jasmine.any(Function), 15000);
      await notifications.showUndo.calls.mostRecent().args[1]();
      expect(disk).toBe(original);
      expect(electron.writeFileAtomic.calls.mostRecent().args).toEqual(['/throwaway/book.md', original]);
    });

    it('refuses to remove lines edited while confirmation was open', async () => {
      modal.confirm.and.callFake(async () => { disk = disk.replace('Ghost Teller', 'New typed name'); return true; });
      await expectAsync(service.repair(item)).toBeRejectedWithError(/file changed/i);
      expect(electron.writeFileAtomic).not.toHaveBeenCalled();
      expect(notifications.showUndo).not.toHaveBeenCalled();
    });

    it('preserves later edits when Undo is clicked', async () => {
      await service.repair(item);
      disk += 'New notes';
      const edited = disk;
      await notifications.showUndo.calls.mostRecent().args[1]();
      expect(disk).toBe(edited);
      expect(electron.writeFileAtomic).toHaveBeenCalledTimes(1);
      expect(notifications.showError).toHaveBeenCalledWith(jasmine.stringContaining('changed'));
    });

    it('does not undo into another project', async () => {
      await service.repair(item);
      project = { ...project, path: '/other' };
      await notifications.showUndo.calls.mostRecent().args[1]();
      expect(electron.writeFileAtomic).toHaveBeenCalledTimes(1);
      expect(notifications.showError).toHaveBeenCalledWith(jasmine.stringContaining('project changed'));
    });

    it('reports a failed restore without changing the repaired file', async () => {
      await service.repair(item);
      const repaired = disk;
      electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Permission denied' });
      await notifications.showUndo.calls.mostRecent().args[1]();
      expect(disk).toBe(repaired);
      expect(notifications.showError).toHaveBeenCalledWith(jasmine.stringContaining('Permission denied'));
    });

    it('does not offer Undo when saving the repair fails', async () => {
      electron.writeFileAtomic.and.resolveTo({ success: false, error: 'Permission denied' });
      await expectAsync(service.repair(item)).toBeRejectedWithError('Permission denied');
      expect(notifications.showUndo).not.toHaveBeenCalled();
      expect(disk).toBe(original);
    });
  });

  it('checks portrait file existence using the character directory for bare filenames', async () => {
    characters.getReferenceCharactersSnapshot = () => [{ id: 'a', name: 'A', content: '', books: [],
      relativePath: 'a/a.md', filePath: '/throwaway/characters/a/a.md', thumbnails: { default: 'missing.png' } }];
    const result = await service.scan();
    expect(electron.fileExists).toHaveBeenCalledWith('/throwaway/characters/a/missing.png');
    expect(result.some(item => item.message.includes('Portrait file not found'))).toBeTrue();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });
});
