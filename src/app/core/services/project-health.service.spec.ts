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
  const finding = (): HealthFinding => ({ name: 'Cast', content: '', route: ['/cast', 'cast'],
    group: 'Orphaned IDs', message: 'Members: missing ID gone',
    fix: { kind: 'cast', owner: 'cast', field: 'Members', missing: 'gone' } });

  beforeEach(() => {
    project = { path: '/throwaway', metadata: { settings: {}, books: [], pinboards: [] } };
    projects = { getCurrentProject: () => project, updatePinboardById: jasmine.createSpy().and.resolveTo(),
      getCastsFolderPath: () => '/throwaway/casts' };
    electron = { fileExists: jasmine.createSpy().and.resolveTo(false), readFile: jasmine.createSpy(),
      writeFileAtomic: jasmine.createSpy().and.resolveTo({ success: true }), createDirectory: jasmine.createSpy() };
    modal = { confirm: jasmine.createSpy().and.resolveTo(false) };
    casts = { readHealthSnapshot: jasmine.createSpy().and.resolveTo([{ id: 'cast', name: 'Cast', characterIds: ['gone'] }]),
      removeOrphanedId: jasmine.createSpy().and.resolveTo(), loadCasts: jasmine.createSpy() };
    houses = { readHealthSnapshot: jasmine.createSpy().and.resolveTo([]), removeOrphanedId: jasmine.createSpy(), loadHouses: jasmine.createSpy() };
    characters = { getReferenceCharactersSnapshot: () => [], getDraftsSnapshot: () => [], loadCharacters: jasmine.createSpy() };
    characters.readHealthSnapshot = async () => [...characters.getReferenceCharactersSnapshot(), ...characters.getDraftsSnapshot()];
    TestBed.configureTestingModule({ providers: [ProjectHealthService,
      { provide: ProjectService, useValue: projects }, { provide: ElectronService, useValue: electron },
      { provide: ModalService, useValue: modal }, { provide: CastService, useValue: casts },
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

  it('checks portrait file existence using the character directory for bare filenames', async () => {
    characters.getReferenceCharactersSnapshot = () => [{ id: 'a', name: 'A', content: '', books: [],
      relativePath: 'a/a.md', filePath: '/throwaway/characters/a/a.md', thumbnails: { default: 'missing.png' } }];
    const result = await service.scan();
    expect(electron.fileExists).toHaveBeenCalledWith('/throwaway/characters/a/missing.png');
    expect(result.some(item => item.message.includes('Portrait file not found'))).toBeTrue();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  });
});
