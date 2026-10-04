import { CastService } from './cast.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';
import { Project, Pinboard } from '../interfaces/project.interface';

/** In-memory disk exercises the real migration and index reload paths. */
describe('Cast canvases', () => {
  let service: CastService;
  let project: Project;
  let files: Map<string, string>;
  let directories: Set<string>;

  const board = (id: string, name = 'Court'): Pinboard => ({
    id, name,
    nodes: [
      { id: 'a', name: 'Alice', position: { x: 50, y: 75 } },
      { id: 'b', name: 'Bob', position: { x: 200, y: 100 } },
    ],
    edges: [{ id: 'alliance', source: 'a', target: 'b', type: '', label: 'allies', color: '#fff' }],
    viewState: { zoomIndex: 2, viewPosition: { x: 10, y: 20 } },
  });

  beforeEach(() => {
    files = new Map();
    directories = new Set();
    project = { path: '/project', metadata: {
      projectName: 'Test', version: '1', categories: [], tags: [], books: [],
      settings: { defaultCategory: '' }, pinboards: [],
    } };
    const electron = {
      fileExists: async (path: string) => files.has(path) || directories.has(path),
      createDirectory: async (path: string) => { directories.add(path); return { success: true }; },
      writeFileAtomic: async (path: string, content: string) => { files.set(path, content); return { success: true }; },
      readFile: async (path: string) => ({ success: files.has(path), content: files.get(path) }),
      readDirectoryFiles: async (path: string) => ({
        success: true,
        directories: [...directories].filter(item => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes('/')).map(item => item.slice(path.length + 1)),
        files: [...files.keys()].filter(item => item.startsWith(`${path}/`) && !item.slice(path.length + 1).includes('/')).map(item => item.slice(path.length + 1)),
      }),
      deleteDirectoryRecursive: async (path: string) => {
        directories.delete(path);
        for (const file of files.keys()) if (file.startsWith(`${path}/`)) files.delete(file);
        return { success: true };
      },
    } as unknown as ElectronService;
    const projects = {
      getCurrentProject: () => project,
      getCastsFolderPath: () => '/project/casts',
      getPinboards: () => project.metadata.pinboards || [],
      updateMetadata: async (updates: Partial<Project['metadata']>) => { Object.assign(project.metadata, updates); },
      deletePinboard: async (id: string) => {
        project.metadata.pinboards = project.metadata.pinboards?.filter(item => item.id !== id);
      },
    } as unknown as ProjectService;
    service = new CastService(electron, projects, { error: () => {}, warn: () => {} } as unknown as LoggingService);
  });

  it('migrates legacy boards once, preserving positions, relationships and view state', async () => {
    const legacy = board('legacy');
    project.metadata.pinboards = [legacy];
    await Promise.all([service.loadCasts(project.path), service.loadCasts(project.path)]);
    const cast = service.getCastsSnapshot()[0];
    expect(cast.characterIds).toEqual(['a', 'b']);
    expect(cast.pinboardId).toBe('legacy');
    expect(project.metadata.pinboards![0]).toEqual(legacy);
    await service.forceReloadCasts();
    expect(service.getCastsSnapshot().length).toBe(1);
    expect(service.getCastsSnapshot()[0].id).toBe(cast.id);
  });

  it('keeps same-name legacy boards separate from existing casts', async () => {
    await service.loadCasts(project.path);
    const original = await service.createCast({ name: 'Court', characterIds: ['c'] });
    project.metadata.pinboards!.push(board('legacy'));
    await service.forceReloadCasts();
    expect(service.getCastsSnapshot().length).toBe(2);
    expect(service.getCastById(original.id)?.characterIds).toEqual(['c']);
    expect(service.getCastsSnapshot().find(cast => cast.pinboardId === 'legacy')?.name).toBe('Court (2)');
  });

  it('always shows all members and removes only the changed cast’s connections', async () => {
    project.metadata.pinboards = [board('first'), board('second', 'Other')];
    await service.loadCasts(project.path);
    const first = service.getCastsSnapshot().find(cast => cast.pinboardId === 'first')!;
    await service.updateCast(first.id, { characterIds: ['a', 'c'] });
    const updated = project.metadata.pinboards!.find(item => item.id === 'first')!;
    expect(updated.nodes.map(node => node.id)).toEqual(['a', 'c']);
    expect(updated.nodes[0].position).toEqual({ x: 50, y: 75 });
    expect(updated.edges).toEqual([]);
    expect(project.metadata.pinboards!.find(item => item.id === 'second')).toEqual(board('second', 'Other'));
  });

  it('creates no default cast for an empty project and deletes a cast with its canvas', async () => {
    await service.loadCasts(project.path);
    expect(service.getCastsSnapshot()).toEqual([]);
    const cast = await service.createCast({ name: 'New', characterIds: ['a', 'b'] });
    expect(project.metadata.pinboards![0].nodes.map(node => node.id)).toEqual(['a', 'b']);
    await service.deleteCast(cast.id);
    await service.forceReloadCasts();
    expect(service.getCastsSnapshot()).toEqual([]);
    expect(project.metadata.pinboards).toEqual([]);
  });
});
