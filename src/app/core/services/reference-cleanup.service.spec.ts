import { TestBed } from '@angular/core/testing';
import { ReferenceCleanupService } from './reference-cleanup.service';
import { HouseService } from './house.service';
import { PinboardService } from './pinboard.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { PromptService } from './prompt.service';

describe('ReferenceCleanupService', () => {
  let service: ReferenceCleanupService;
  let houseService: jasmine.SpyObj<HouseService>;
  let pinboardService: jasmine.SpyObj<PinboardService>;
  let plotBoardService: jasmine.SpyObj<PlotBoardService>;
  let castService: jasmine.SpyObj<CastService>;
  let metadataService: jasmine.SpyObj<MetadataService>;
  let loggingService: jasmine.SpyObj<LoggingService>;
  let notificationService: jasmine.SpyObj<NotificationService>;
  let promptService: jasmine.SpyObj<PromptService>;

  beforeEach(() => {
    const houseSpy = jasmine.createSpyObj('HouseService', [
      'countCharacterReferences',
      'removeCharacterFromHouses',
      'restoreCharacterToHouses',
      'clearLocationReferences',
      'restoreLocationReferences',
    ]);
    const pinboardSpy = jasmine.createSpyObj('PinboardService', [
      'countCharacterReferences',
      'removeCharacterConnections',
      'restoreCharacterConnections',
    ]);
    const plotBoardSpy = jasmine.createSpyObj('PlotBoardService', [
      'countCharacterReferences',
      'removeCharacterFromThreads',
      'restoreCharacterToThreads',
    ]);
    const castSpy = jasmine.createSpyObj('CastService', [
      'countCharacterInCasts',
      'removeCharacterFromCasts',
      'restoreCharacterToCasts',
    ]);
    const metadataSpy = jasmine.createSpyObj('MetadataService', [
      'removeCharacterFromBookPovs',
      'restoreCharacterToBookPovs',
    ]);
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['error', 'warn']);
    const notificationSpy = jasmine.createSpyObj('NotificationService', [
      'showError',
      'showWarning',
    ]);

    const promptSpy = jasmine.createSpyObj('PromptService', ['countLinks', 'removeLinks', 'restoreLinks']);
    promptSpy.countLinks.and.resolveTo([]);
    promptSpy.removeLinks.and.callFake(async (field: 'characters' | 'locations', targetId: string) => ({
      field,
      targetId,
      removals: [],
    }));
    promptSpy.restoreLinks.and.resolveTo({ restored: 0, skipped: [] });

    TestBed.configureTestingModule({
      providers: [
        { provide: PromptService, useValue: promptSpy },
        ReferenceCleanupService,
        { provide: HouseService, useValue: houseSpy },
        { provide: PinboardService, useValue: pinboardSpy },
        { provide: PlotBoardService, useValue: plotBoardSpy },
        { provide: CastService, useValue: castSpy },
        { provide: MetadataService, useValue: metadataSpy },
        { provide: LoggingService, useValue: loggingSpy },
        { provide: NotificationService, useValue: notificationSpy },
      ]
    });

    service = TestBed.inject(ReferenceCleanupService);
    houseService = TestBed.inject(HouseService) as jasmine.SpyObj<HouseService>;
    pinboardService = TestBed.inject(PinboardService) as jasmine.SpyObj<PinboardService>;
    plotBoardService = TestBed.inject(PlotBoardService) as jasmine.SpyObj<PlotBoardService>;
    castService = TestBed.inject(CastService) as jasmine.SpyObj<CastService>;
    metadataService = TestBed.inject(MetadataService) as jasmine.SpyObj<MetadataService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
    notificationService = TestBed.inject(
      NotificationService
    ) as jasmine.SpyObj<NotificationService>;
    promptService = TestBed.inject(PromptService) as jasmine.SpyObj<PromptService>;
  });

  describe('prompt links', () => {
    const promptSnapshot = (field: 'characters' | 'locations', targetId: string) => ({
      field,
      targetId,
      removals: [{ relativePath: 'a/Mara.md', promptName: 'Mara', index: 0 }],
    });

    beforeEach(() => {
      houseService.countCharacterReferences.and.returnValue([]);
      castService.countCharacterInCasts.and.returnValue([]);
      pinboardService.countCharacterReferences.and.returnValue([]);
      plotBoardService.countCharacterReferences.and.returnValue(Promise.resolve([]));
      houseService.clearLocationReferences.and.resolveTo({ locationId: 'loc-1', seats: [] });
      houseService.restoreLocationReferences.and.resolveTo({ restored: 0, skipped: [] });
    });

    it('counts prompts linking a character, draft or location', async () => {
      promptService.countLinks.and.resolveTo([{ id: 'a/Mara.md', name: 'Mara' }]);

      expect((await service.countCharacterReferences('char-1')).prompts).toEqual([{ id: 'a/Mara.md', name: 'Mara' }]);
      expect(await service.countDraftReferences('draft-1')).toEqual({ prompts: [{ id: 'a/Mara.md', name: 'Mara' }] });
      expect(await service.countLocationReferences('loc-1')).toEqual({ prompts: [{ id: 'a/Mara.md', name: 'Mara' }] });
      expect(promptService.countLinks.calls.allArgs()).toEqual([
        ['characters', 'char-1'],
        ['characters', 'draft-1'],
        ['locations', 'loc-1'],
      ]);
    });

    it('still counts the other references when prompts cannot be read', async () => {
      promptService.countLinks.and.rejectWith(new Error('no prompts folder'));
      houseService.countCharacterReferences.and.returnValue([{ id: 'h1', name: 'House' }]);

      const refs = await service.countCharacterReferences('char-1');

      expect(refs.houses).toEqual([{ id: 'h1', name: 'House' }]);
      expect(refs.prompts).toEqual([]);
    });

    it('character cleanup snapshots prompt links and restore hands them back', async () => {
      metadataService.removeCharacterFromBookPovs.and.resolveTo({ characterId: 'char-1', removals: [] });
      castService.removeCharacterFromCasts.and.resolveTo({ characterId: 'char-1', removals: [] });
      houseService.removeCharacterFromHouses.and.resolveTo({ characterId: 'char-1', removals: [] });
      pinboardService.removeCharacterConnections.and.resolveTo({ characterId: 'char-1', removals: [] });
      plotBoardService.removeCharacterFromThreads.and.resolveTo({ characterId: 'char-1', removals: [] });
      metadataService.restoreCharacterToBookPovs.and.resolveTo({ restored: 0, skipped: [] });
      castService.restoreCharacterToCasts.and.resolveTo({ restored: 0, skipped: [] });
      houseService.restoreCharacterToHouses.and.resolveTo({ restored: 0, skipped: [] });
      pinboardService.restoreCharacterConnections.and.resolveTo({ restored: 0, skipped: [] });
      plotBoardService.restoreCharacterToThreads.and.resolveTo({ restored: 0, skipped: [] });
      const prompts = promptSnapshot('characters', 'char-1');
      promptService.removeLinks.and.resolveTo(prompts);
      promptService.restoreLinks.and.resolveTo({ restored: 1, skipped: [] });

      const snapshot = await service.removeCharacterReferences('char-1');
      expect(promptService.removeLinks).toHaveBeenCalledWith('characters', 'char-1');
      expect(snapshot.prompts).toEqual(prompts);

      const result = await service.restoreCharacterReferences(snapshot);
      expect(promptService.restoreLinks).toHaveBeenCalledWith(prompts);
      expect(result.restored).toBe(1);
    });

    it('draft cleanup only touches prompts', async () => {
      const prompts = promptSnapshot('characters', 'draft-1');
      promptService.removeLinks.and.resolveTo(prompts);

      const snapshot = await service.removeDraftReferences('draft-1');

      expect(snapshot.prompts).toEqual(prompts);
      expect(houseService.removeCharacterFromHouses).not.toHaveBeenCalled();
      expect(castService.removeCharacterFromCasts).not.toHaveBeenCalled();
    });

    it('a prompt unlink failure aborts character cleanup before any other reference is touched', async () => {
      const failure = new Error('could not update prompt "Mara"');
      promptService.removeLinks.and.rejectWith(failure);

      await expectAsync(service.removeCharacterReferences('char-1')).toBeRejectedWith(failure);

      expect(metadataService.removeCharacterFromBookPovs).not.toHaveBeenCalled();
      expect(castService.removeCharacterFromCasts).not.toHaveBeenCalled();
      expect(houseService.removeCharacterFromHouses).not.toHaveBeenCalled();
      expect(pinboardService.removeCharacterConnections).not.toHaveBeenCalled();
      expect(plotBoardService.removeCharacterFromThreads).not.toHaveBeenCalled();
    });

    it('a prompt unlink failure aborts draft and location cleanup', async () => {
      const failure = new Error('could not update prompt "Mara"');
      promptService.removeLinks.and.rejectWith(failure);

      await expectAsync(service.removeDraftReferences('draft-1')).toBeRejectedWith(failure);
      await expectAsync(service.clearLocationReferences('loc-1')).toBeRejectedWith(failure);
      expect(houseService.clearLocationReferences).not.toHaveBeenCalled();
    });

    it('location cleanup adds prompt links to the seat snapshot and restores both', async () => {
      const prompts = promptSnapshot('locations', 'loc-1');
      promptService.removeLinks.and.resolveTo(prompts);
      promptService.restoreLinks.and.resolveTo({
        restored: 0,
        skipped: [{ kind: 'prompt', id: 'a/Mara.md', label: 'Mara' }],
      });

      const snapshot = await service.clearLocationReferences('loc-1');
      expect(snapshot).toEqual({ locationId: 'loc-1', seats: [], prompts });

      const result = await service.restoreLocationReferences(snapshot);
      expect(houseService.restoreLocationReferences).toHaveBeenCalledWith(snapshot);
      expect(result.skipped).toEqual([{ kind: 'prompt', id: 'a/Mara.md', label: 'Mara' }]);
    });
  });

  describe('countCharacterReferences', () => {
    it('should count references across all services including pinboards', async () => {
      houseService.countCharacterReferences.and.returnValue([
        { id: 'house-1', name: 'House Stark' },
        { id: 'house-2', name: 'House Tully' }
      ]);
      castService.countCharacterInCasts.and.returnValue([{ id: 'cast-1', name: 'Cast 1' }]);
      pinboardService.countCharacterReferences.and.returnValue([
        { id: 'pb-1', name: 'Pinboard 1' },
        { id: 'pb-2', name: 'Pinboard 2' },
        { id: 'pb-3', name: 'Pinboard 3' }
      ]);
      plotBoardService.countCharacterReferences.and.returnValue(Promise.resolve([
        { id: 'plot.plotboard.md', name: 'plot' }
      ]));

      const result = await service.countCharacterReferences('char-1');

      expect(result.houses.length).toBe(2);
      expect(result.casts.length).toBe(1);
      expect(result.pinboards.length).toBe(3);
      expect(result.plotBoards.length).toBe(1);
      expect(result.houses[0].name).toBe('House Stark');
    });

    it('should return empty arrays if counting fails', async () => {
      houseService.countCharacterReferences.and.throwError('Database error');

      const result = await service.countCharacterReferences('char-1');

      expect(result.houses.length).toBe(0);
      expect(result.casts.length).toBe(0);
      expect(result.pinboards.length).toBe(0);
      expect(result.plotBoards.length).toBe(0);
      expect(loggingService.error).toHaveBeenCalled();
    });
  });

  const emptySnap = (characterId: string) => ({
    characterId,
    removals: [] as never[],
  });

  describe('removeCharacterReferences', () => {
    beforeEach(() => {
      metadataService.removeCharacterFromBookPovs.and.returnValue(
        Promise.resolve(emptySnap('char-1'))
      );
      castService.removeCharacterFromCasts.and.returnValue(Promise.resolve(emptySnap('char-1')));
      houseService.removeCharacterFromHouses.and.returnValue(Promise.resolve(emptySnap('char-1')));
      pinboardService.removeCharacterConnections.and.returnValue(
        Promise.resolve(emptySnap('char-1'))
      );
      plotBoardService.removeCharacterFromThreads.and.returnValue(
        Promise.resolve(emptySnap('char-1'))
      );
    });

    it('should remove character from book PoVs', async () => {
      await service.removeCharacterReferences('char-1');

      expect(metadataService.removeCharacterFromBookPovs).toHaveBeenCalledWith('char-1');
    });

    it('should remove character from casts', async () => {
      await service.removeCharacterReferences('char-1');

      expect(castService.removeCharacterFromCasts).toHaveBeenCalledWith('char-1');
    });

    it('should remove character from houses', async () => {
      await service.removeCharacterReferences('char-1');

      expect(houseService.removeCharacterFromHouses).toHaveBeenCalledWith('char-1');
    });

    it('should remove character from pinboards', async () => {
      await service.removeCharacterReferences('char-1');

      expect(pinboardService.removeCharacterConnections).toHaveBeenCalledWith('char-1');
    });

    it('should remove character from plot threads', async () => {
      await service.removeCharacterReferences('char-1');

      expect(plotBoardService.removeCharacterFromThreads).toHaveBeenCalledWith('char-1');
    });

    it('should continue cleanup even if one step fails', async () => {
      castService.removeCharacterFromCasts.and.returnValue(Promise.reject(new Error('Cast error')));

      await service.removeCharacterReferences('char-1');

      // All other cleanup methods should still be called
      expect(metadataService.removeCharacterFromBookPovs).toHaveBeenCalledWith('char-1');
      expect(houseService.removeCharacterFromHouses).toHaveBeenCalledWith('char-1');
      expect(pinboardService.removeCharacterConnections).toHaveBeenCalledWith('char-1');
      expect(plotBoardService.removeCharacterFromThreads).toHaveBeenCalledWith('char-1');
      expect(loggingService.error).toHaveBeenCalled();
      expect(loggingService.warn).toHaveBeenCalled();
    });

    it('should continue cleanup even if multiple steps fail', async () => {
      castService.removeCharacterFromCasts.and.returnValue(Promise.reject(new Error('Cast error')));
      houseService.removeCharacterFromHouses.and.returnValue(Promise.reject(new Error('House error')));

      await service.removeCharacterReferences('char-1');

      // Other cleanup methods should still be called
      expect(metadataService.removeCharacterFromBookPovs).toHaveBeenCalledWith('char-1');
      expect(pinboardService.removeCharacterConnections).toHaveBeenCalledWith('char-1');
      expect(plotBoardService.removeCharacterFromThreads).toHaveBeenCalledWith('char-1');
      expect(loggingService.error).toHaveBeenCalledTimes(2);
      expect(loggingService.warn).toHaveBeenCalled();
    });

    it('keeps cast/pinboard/plot snapshots when the House step fails with a partial snapshot', async () => {
      const castSnap = {
        characterId: 'char-1',
        removals: [{ castId: 'c1', castName: 'Main', index: 0, characterIds: ['char-1'] }],
      };
      const pinSnap = {
        characterId: 'char-1',
        removals: [{ pinboardId: 'p1', pinboardName: 'Board', nodes: [], edges: [] }],
      };
      const plotSnap = {
        characterId: 'char-1',
        removals: [{ boardPath: 'a.plotboard.md', boardName: 'a', threadId: 't1', index: 0 }],
      };
      const housePartial = {
        characterId: 'char-1',
        removals: [
          {
            houseId: 'h-ok',
            houseName: 'House Ok',
            characterIds: ['char-1'],
            leadership: [],
            currentLeadershipId: undefined,
            prunedReigns: [],
          },
        ],
      };
      castService.removeCharacterFromCasts.and.returnValue(Promise.resolve(castSnap as any));
      pinboardService.removeCharacterConnections.and.returnValue(Promise.resolve(pinSnap as any));
      plotBoardService.removeCharacterFromThreads.and.returnValue(Promise.resolve(plotSnap as any));
      const houseError: any = new Error('mid-loop');
      houseError.partialSnapshot = housePartial;
      houseError.failedHouseNames = ['House Fail'];
      houseService.removeCharacterFromHouses.and.returnValue(Promise.reject(houseError));

      const snapshot = await service.removeCharacterReferences('char-1');

      expect(snapshot.houses).toEqual(housePartial as any);
      expect(snapshot.casts).toEqual(castSnap as any);
      expect(snapshot.pinboards).toEqual(pinSnap as any);
      expect(snapshot.plotThreads).toEqual(plotSnap as any);
      expect(notificationService.showWarning).toHaveBeenCalledWith(
        `Couldn't update the House "House Fail", so this link was left in place.`
      );
    });
  });

  describe('clearLocationReferences', () => {
    it('should clear house references to location', async () => {
      houseService.clearLocationReferences.and.returnValue(
        Promise.resolve({ locationId: 'loc-1', seats: [] })
      );

      await service.clearLocationReferences('loc-1');

      expect(houseService.clearLocationReferences).toHaveBeenCalledWith('loc-1');
    });

    it('should handle errors gracefully', async () => {
      houseService.clearLocationReferences.and.returnValue(Promise.reject(new Error('House error')));

      const result = await service.clearLocationReferences('loc-1');

      expect(loggingService.error).toHaveBeenCalled();
      expect(result.seats).toEqual([]);
    });

    it('keeps a partial seat snapshot when clearLocationReferences throws with one', async () => {
      const partial = {
        locationId: 'loc-1',
        seats: [{ houseId: 'h1', houseName: 'House Ok', seatId: 'loc-1' }],
      };
      const err: any = new Error('mid-loop');
      err.partialSnapshot = partial;
      err.failedHouseNames = ['House Fail'];
      houseService.clearLocationReferences.and.returnValue(Promise.reject(err));

      const result = await service.clearLocationReferences('loc-1');

      expect(result).toEqual({ ...partial, prompts: { field: 'locations', targetId: 'loc-1', removals: [] } });
      expect(notificationService.showWarning).toHaveBeenCalledWith(
        `Couldn't update the House "House Fail", so this link was left in place.`
      );
      expect(loggingService.error).not.toHaveBeenCalled();
    });
  });

  describe('Plot thread cleanup', () => {
    beforeEach(() => {
      plotBoardService.removeCharacterFromThreads.and.returnValue(
        Promise.resolve(emptySnap('char-1'))
      );
      plotBoardService.countCharacterReferences.and.returnValue(Promise.resolve([
        { id: 'board1.plotboard.md', name: 'board1' }
      ]));
    });

    it('should count character references in plot threads', async () => {
      const result = await service.countCharacterReferences('char-1');

      expect(plotBoardService.countCharacterReferences).toHaveBeenCalledWith('char-1');
      expect(result.plotBoards.length).toBe(1);
      expect(result.plotBoards[0].name).toBe('board1');
    });

    it('should remove character from plot threads', async () => {
      await service.removeCharacterReferences('char-1');

      expect(plotBoardService.removeCharacterFromThreads).toHaveBeenCalledWith('char-1');
    });

    it('should continue cleanup if plot thread removal fails', async () => {
      plotBoardService.removeCharacterFromThreads.and.returnValue(Promise.reject(new Error('Plot error')));
      metadataService.removeCharacterFromBookPovs.and.returnValue(
        Promise.resolve(emptySnap('char-1'))
      );
      castService.removeCharacterFromCasts.and.returnValue(Promise.resolve(emptySnap('char-1')));
      houseService.removeCharacterFromHouses.and.returnValue(Promise.resolve(emptySnap('char-1')));
      pinboardService.removeCharacterConnections.and.returnValue(
        Promise.resolve(emptySnap('char-1'))
      );

      await service.removeCharacterReferences('char-1');

      // All other cleanup methods should still be called
      expect(metadataService.removeCharacterFromBookPovs).toHaveBeenCalledWith('char-1');
      expect(castService.removeCharacterFromCasts).toHaveBeenCalledWith('char-1');
      expect(houseService.removeCharacterFromHouses).toHaveBeenCalledWith('char-1');
      expect(pinboardService.removeCharacterConnections).toHaveBeenCalledWith('char-1');
      expect(loggingService.error).toHaveBeenCalled();
      expect(loggingService.warn).toHaveBeenCalled();
    });
  });
});
