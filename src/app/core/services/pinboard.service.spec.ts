import { TestBed } from '@angular/core/testing';
import { of, EMPTY } from 'rxjs';
import { PinboardService } from './pinboard.service';
import { ProjectService } from './project.service';
import { CharacterService } from './character.service';
import { CastService } from './cast.service';
import { CastEditorSessionService } from './cast-editor-session.service';
import { LoggingService } from './logging.service';

describe('PinboardService', () => {
  let service: PinboardService;
  let cast: { id: string; name: string; pinboardId: string; characterIds: string[] };
  let updateCast: jasmine.Spy;
  let updatePinboard: jasmine.Spy;

  beforeEach(() => {
    cast = { id: 'cast1', name: 'Crew', pinboardId: 'board1', characterIds: [] };
    updateCast = jasmine
      .createSpy('updateCast')
      .and.callFake(async (_id: string, updates: { characterIds: string[] }) => Object.assign(cast, updates));
    updatePinboard = jasmine.createSpy('updatePinboard').and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        PinboardService,
        {
          provide: ProjectService,
          useValue: {
            currentProject$: of(null),
            getCurrentProject: () => ({ path: '/w', metadata: { pinboards: [] } }),
            getCurrentPinboard: () => ({ id: 'board1', nodes: [], edges: [] }),
            updatePinboard,
            setCurrentPinboard: jasmine.createSpy('setCurrentPinboard').and.resolveTo(),
          },
        },
        { provide: CharacterService, useValue: {} },
        { provide: CastService, useValue: { getCastsSnapshot: () => [cast], updateCast } },
        { provide: CastEditorSessionService, useValue: { changes$: EMPTY, cast: null, board: null, updateData: () => {}, updateCast: () => {} } },
        { provide: LoggingService, useValue: { error: () => {}, warn: () => {}, info: () => {} } },
      ],
    });
    service = TestBed.inject(PinboardService);
  });

  describe('edge operations', () => {
    it('createConnection adds a connection with a generated id and persists it', async () => {
      const created = await service.createConnection({ source: 'c1', target: 'c2', label: 'knows', color: '#fff' } as any);
      expect(created.id).toBeTruthy();
      const { edges } = service.getCurrentPinboardDataSnapshot();
      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('c1');
      expect(edges[0].target).toBe('c2');
      expect(edges[0].label).toBe('knows');
      expect(updatePinboard).toHaveBeenCalled();
    });

    it('updateConnection edits an existing connection', async () => {
      const created = await service.createConnection({ source: 'c1', target: 'c2', label: 'knows' } as any);
      const updated = await service.updateConnection(created.id, { label: 'rivals', color: '#000' } as any);
      expect(updated?.label).toBe('rivals');
      expect(service.getCurrentPinboardDataSnapshot().edges[0].color).toBe('#000');
    });

    it('updateConnection returns null for an unknown id', async () => {
      expect(await service.updateConnection('missing', { label: 'x' } as any)).toBeNull();
    });

    it('deleteConnection removes the connection and reports success', async () => {
      const created = await service.createConnection({ source: 'c1', target: 'c2' } as any);
      expect(await service.deleteConnection(created.id)).toBeTrue();
      expect(service.getCurrentPinboardDataSnapshot().edges.length).toBe(0);
      expect(await service.deleteConnection('missing')).toBeFalse();
    });
  });

  describe('pin add/remove', () => {
    it('addPin adds the character to the active cast', async () => {
      await service.addPin({ id: 'c1', name: 'Mara' });
      expect(updateCast).toHaveBeenCalledWith('cast1', { characterIds: ['c1'] });
    });

    it('addPin is a no-op when the character is already on the cast', async () => {
      cast.characterIds = ['c1'];
      await service.addPin({ id: 'c1', name: 'Mara' });
      expect(updateCast).not.toHaveBeenCalled();
    });

    it('removePin removes the character from the cast', async () => {
      cast.characterIds = ['c1', 'c2'];
      await service.removePin('c1');
      expect(updateCast).toHaveBeenCalledWith('cast1', { characterIds: ['c2'] });
    });
  });
});
