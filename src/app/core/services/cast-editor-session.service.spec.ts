import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { CastEditorSessionService } from './cast-editor-session.service';
import { PinboardService } from './pinboard.service';
import { ProjectService } from './project.service';
import { CharacterService } from './character.service';
import { CastService } from './cast.service';
import { LoggingService } from './logging.service';
import { Cast, Pinboard } from '../interfaces/project.interface';

describe('Shared cast editor draft', () => {
  let session: CastEditorSessionService;
  let pins: PinboardService;
  let savedCast: Cast;
  let savedBoard: Pinboard;
  let write: jasmine.Spy;

  beforeEach(() => {
    session = new CastEditorSessionService();
    savedCast = { id: 'cast', name: 'Court', pinboardId: 'board', characterIds: ['a', 'b'] };
    savedBoard = { id: 'board', name: 'Court', nodes: [
      { id: 'a', name: 'Alice', position: { x: 10, y: 20 } },
      { id: 'b', name: 'Bob', position: { x: 200, y: 0 } },
    ], edges: [] };
    const project = { path: '/test', metadata: { lastSession: { lastPinboardId: 'board' } } };
    write = jasmine.createSpy('write').and.resolveTo();
    const projects = {
      currentProject$: new BehaviorSubject(project), getCurrentProject: () => project,
      getCurrentPinboard: () => savedBoard, updatePinboard: write,
    } as unknown as ProjectService;
    TestBed.configureTestingModule({});
    pins = TestBed.runInInjectionContext(() => new PinboardService(
      projects, {} as CharacterService, {} as CastService, session, {} as LoggingService,
    ));
    session.begin(savedCast, savedBoard);
  });

  it('keeps membership, relationships and positions pending together', async () => {
    await pins.addPin({ id: 'c', name: 'Carol', category: '' });
    await pins.createConnection({ source: 'a', target: 'c', label: 'allies', type: '', color: '#fff' });
    await pins.updatePinPosition('a', { x: 400, y: 300 });
    expect(session.cast?.characterIds).toEqual(['a', 'b', 'c']);
    expect(session.board?.edges.length).toBe(1);
    expect(session.board?.nodes[0].position).toEqual({ x: 400, y: 300 });
    expect(savedCast.characterIds).toEqual(['a', 'b']);
    expect(savedBoard.nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(savedBoard.edges).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('reconciles member-form changes without losing surviving layout or connections', async () => {
    await pins.createConnection({ source: 'a', target: 'b', label: 'allies', type: '', color: '#fff' });
    session.updateCast({ name: 'New Court', description: 'Pending description', characterIds: ['a', 'b', 'c'] });
    expect(session.board?.name).toBe('New Court');
    expect(session.board?.edges.length).toBe(1);
    expect(session.board?.nodes[0].position).toEqual({ x: 10, y: 20 });
    await pins.removePin('b');
    expect(session.cast?.characterIds).toEqual(['a', 'c']);
    expect(session.board?.edges).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it('discards all pending changes on cancel and restores the saved canvas', async () => {
    await pins.removePin('b');
    await pins.updatePinPosition('a', { x: 500, y: 500 });
    session.updateViewState({ zoomIndex: 3, viewPosition: { x: 100, y: 100 } });
    session.end();
    expect(session.cast).toBeNull();
    expect(pins.getCurrentPinboardDataSnapshot()).toEqual({ nodes: savedBoard.nodes, edges: savedBoard.edges });
    expect(savedBoard.viewState).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });
});
