import { CastService } from './cast.service';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { UndoDeleteService } from './undo-delete.service';
import { Project, Pinboard } from '../interfaces/project.interface';

/** In-memory disk exercises the real migration and index reload paths. */
describe('Cast canvases', () => {
  let service: CastService;
  let project: Project;
  let files: Map<string, string>;
  let directories: Set<string>;
  let stageCalls: { projectPath: string; targetPath: string; meta: any }[];
  let restoreCalls: string[];
  let deleteDirCalls: string[];
  let undoRegister: jasmine.Spy;
  let showError: jasmine.Spy;
  let electron: any;
  let projects: any;

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
    stageCalls = [];
    restoreCalls = [];
    deleteDirCalls = [];
    undoRegister = jasmine.createSpy('register');
    showError = jasmine.createSpy('showError');
    project = { path: '/project', metadata: {
      projectName: 'Test', version: '1', categories: [], tags: [], books: [],
      settings: { defaultCategory: '' }, pinboards: [],
    } };
    const stagedFolders = new Map<string, string>(); // token -> folder path
    electron = {
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
        deleteDirCalls.push(path);
        directories.delete(path);
        for (const file of files.keys()) if (file.startsWith(`${path}/`)) files.delete(file);
        return { success: true };
      },
      stageForTrash: async (projectPath: string, targetPath: string, meta: any) => {
        stageCalls.push({ projectPath, targetPath, meta });
        stagedFolders.set('tok-cast', targetPath);
        directories.delete(targetPath);
        for (const file of [...files.keys()]) if (file.startsWith(`${targetPath}/`)) files.delete(file);
        return { success: true, token: 'tok-cast', expiresAt: Date.now() + 15000 };
      },
      restoreFromTrash: async (token: string) => {
        restoreCalls.push(token);
        const folder = stagedFolders.get(token);
        if (folder) {
          directories.add(folder);
          stagedFolders.delete(token);
        }
        return { success: true };
      },
    };
    projects = {
      getCurrentProject: () => project,
      getCastsFolderPath: () => '/project/casts',
      getPinboards: () => project.metadata.pinboards || [],
      updateMetadata: async (updates: Partial<Project['metadata']>) => { Object.assign(project.metadata, updates); },
      deletePinboard: async (id: string) => {
        project.metadata.pinboards = project.metadata.pinboards?.filter(item => item.id !== id);
      },
      restorePinboard: async (pinboard: Pinboard) => {
        const boards = project.metadata.pinboards || [];
        if (!boards.some((b) => b.id === pinboard.id)) {
          project.metadata.pinboards = [...boards, pinboard];
        }
      },
    };
    service = new CastService(
      electron as unknown as ElectronService,
      projects as unknown as ProjectService,
      { error: () => {}, warn: () => {} } as unknown as LoggingService,
      { showError } as unknown as NotificationService,
      { register: undoRegister } as unknown as UndoDeleteService
    );
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

  it('creates no default cast for an empty project and stages a cast with its canvas', async () => {
    await service.loadCasts(project.path);
    expect(service.getCastsSnapshot()).toEqual([]);
    const cast = await service.createCast({ name: 'New', characterIds: ['a', 'b'] });
    expect(project.metadata.pinboards![0].nodes.map(node => node.id)).toEqual(['a', 'b']);
    const folderPath = cast.folderPath!;
    await service.deleteCast(cast.id);
    expect(stageCalls.length).toBe(1);
    expect(stageCalls[0].targetPath).toBe(folderPath);
    expect(stageCalls[0].meta.kind).toBe('cast');
    expect(deleteDirCalls).toEqual([]);
    expect(undoRegister).toHaveBeenCalledWith(
      'tok-cast',
      jasmine.objectContaining({ kind: 'cast', recordId: cast.id, name: 'New' })
    );
    await service.forceReloadCasts();
    expect(service.getCastsSnapshot()).toEqual([]);
    expect(project.metadata.pinboards).toEqual([]);
  });

  it('sanitizes cast ids with a dot for staging and keeps the real id for Undo', async () => {
    await service.loadCasts(project.path);
    const cast = await service.createCast({ name: 'Court', characterIds: ['a'] });
    (cast as any).id = 'cast.court';
    (service as any).castsSubject.next([cast]);
    await service.deleteCast('cast.court');
    expect(stageCalls[0].meta.recordId).toBe('cast_court');
    expect(undoRegister).toHaveBeenCalledWith(
      'tok-cast',
      jasmine.objectContaining({ recordId: 'cast.court' })
    );
  });

  it('on staging failure leaves the cast unchanged and toasts Nothing was changed', async () => {
    await service.loadCasts(project.path);
    const cast = await service.createCast({ name: 'Keep', characterIds: ['a'] });
    electron.stageForTrash = async () => ({ success: false, error: 'nope' });
    await expectAsync(service.deleteCast(cast.id)).toBeRejected();
    expect(service.getCastById(cast.id)).toBeTruthy();
    expect(showError).toHaveBeenCalledWith(
      `Couldn't delete "Keep": nope. Nothing was changed.`
    );
    expect(undoRegister).not.toHaveBeenCalled();
  });

  it('casts.json write failure after staging restores folder and leaves casts.json unchanged', async () => {
    await service.loadCasts(project.path);
    const cast = await service.createCast({ name: 'New', characterIds: ['a', 'b'] });
    const folderPath = cast.folderPath!;
    const castsJsonBefore = files.get('/project/casts/casts.json');
    expect(castsJsonBefore).toBeTruthy();

    electron.writeFileAtomic = async (path: string, content: string) => {
      if (path.endsWith('casts.json')) {
        return { success: false, error: 'disk full' };
      }
      files.set(path, content);
      return { success: true };
    };

    await expectAsync(service.deleteCast(cast.id)).toBeRejected();

    expect(restoreCalls).toEqual(['tok-cast']);
    expect(directories.has(folderPath)).toBeTrue();
    expect(service.getCastById(cast.id)).toBeTruthy();
    expect(files.get('/project/casts/casts.json')).toBe(castsJsonBefore);
    expect(showError).toHaveBeenCalledWith(
      `Couldn't delete "New": Failed to write casts.json: disk full. Nothing was changed.`
    );
    expect(undoRegister).not.toHaveBeenCalled();
  });

  it('deletePinboard failure after staging restores folder, casts.json and pinboard', async () => {
    await service.loadCasts(project.path);
    const cast = await service.createCast({ name: 'Court', characterIds: ['a'] });
    const folderPath = cast.folderPath!;
    const pinboardId = cast.pinboardId!;
    const castsJsonBefore = files.get('/project/casts/casts.json');

    projects.deletePinboard = async () => {
      throw new Error('pinboard write failed');
    };

    await expectAsync(service.deleteCast(cast.id)).toBeRejected();

    expect(restoreCalls).toEqual(['tok-cast']);
    expect(directories.has(folderPath)).toBeTrue();
    expect(service.getCastById(cast.id)).toBeTruthy();
    const castsJson = JSON.parse(files.get('/project/casts/casts.json')!);
    expect(castsJson.casts.some((c: { id: string }) => c.id === cast.id)).toBeTrue();
    expect(project.metadata.pinboards!.some((b) => b.id === pinboardId)).toBeTrue();
    expect(showError).toHaveBeenCalledWith(
      `Couldn't delete "Court": pinboard write failed. Nothing was changed.`
    );
    // castsJsonBefore was captured before the failed delete; entry must still be present.
    expect(castsJsonBefore).toBeTruthy();
  });

  it('when restoreFromTrash also fails, registers Undo instead of leaving the user stranded', async () => {
    await service.loadCasts(project.path);
    const cast = await service.createCast({ name: 'Stuck', characterIds: ['a'] });
    electron.writeFileAtomic = async (path: string, content: string) => {
      if (path.endsWith('casts.json')) {
        return { success: false, error: 'disk full' };
      }
      files.set(path, content);
      return { success: true };
    };
    electron.restoreFromTrash = async (token: string) => {
      restoreCalls.push(token);
      return { success: false, error: 'restore blocked' };
    };

    await expectAsync(service.deleteCast(cast.id)).toBeRejected();
    expect(restoreCalls).toEqual(['tok-cast']);
    expect(undoRegister).toHaveBeenCalledWith(
      'tok-cast',
      jasmine.objectContaining({ kind: 'cast', name: 'Stuck' })
    );
  });

  it('when restore and Undo register both fail, shows sticky .ensemble-trash error', async () => {
    await service.loadCasts(project.path);
    const cast = await service.createCast({ name: 'Orphan', characterIds: ['a'] });
    electron.writeFileAtomic = async (path: string, content: string) => {
      if (path.endsWith('casts.json')) {
        return { success: false, error: 'disk full' };
      }
      files.set(path, content);
      return { success: true };
    };
    electron.restoreFromTrash = async (token: string) => {
      restoreCalls.push(token);
      return { success: false, error: 'gone' };
    };
    undoRegister.and.throwError('register boom');

    await expectAsync(service.deleteCast(cast.id)).toBeRejected();
    expect(showError).toHaveBeenCalledWith(
      jasmine.stringMatching(/\.ensemble-trash\//),
      0
    );
  });
});
