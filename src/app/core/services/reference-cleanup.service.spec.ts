import { TestBed } from '@angular/core/testing';
import { ReferenceCleanupService } from './reference-cleanup.service';
import { HouseService } from './house.service';
import { PinboardService } from './pinboard.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { LoggingService } from './logging.service';

describe('ReferenceCleanupService', () => {
  let service: ReferenceCleanupService;
  let houseService: jasmine.SpyObj<HouseService>;
  let pinboardService: jasmine.SpyObj<PinboardService>;
  let plotBoardService: jasmine.SpyObj<PlotBoardService>;
  let castService: jasmine.SpyObj<CastService>;
  let metadataService: jasmine.SpyObj<MetadataService>;
  let loggingService: jasmine.SpyObj<LoggingService>;

  beforeEach(() => {
    const houseSpy = jasmine.createSpyObj('HouseService', [
      'countCharacterReferences',
      'removeCharacterFromHouses',
      'clearLocationReferences'
    ]);
    const pinboardSpy = jasmine.createSpyObj('PinboardService', [
      'countCharacterReferences',
      'removeCharacterConnections'
    ]);
    const plotBoardSpy = jasmine.createSpyObj('PlotBoardService', [
      'countCharacterReferences',
      'removeCharacterFromThreads'
    ]);
    const castSpy = jasmine.createSpyObj('CastService', [
      'countCharacterInCasts',
      'removeCharacterFromCasts'
    ]);
    const metadataSpy = jasmine.createSpyObj('MetadataService', [
      'removeCharacterFromBookPovs'
    ]);
    const loggingSpy = jasmine.createSpyObj('LoggingService', ['error', 'warn']);

    TestBed.configureTestingModule({
      providers: [
        ReferenceCleanupService,
        { provide: HouseService, useValue: houseSpy },
        { provide: PinboardService, useValue: pinboardSpy },
        { provide: PlotBoardService, useValue: plotBoardSpy },
        { provide: CastService, useValue: castSpy },
        { provide: MetadataService, useValue: metadataSpy },
        { provide: LoggingService, useValue: loggingSpy }
      ]
    });

    service = TestBed.inject(ReferenceCleanupService);
    houseService = TestBed.inject(HouseService) as jasmine.SpyObj<HouseService>;
    pinboardService = TestBed.inject(PinboardService) as jasmine.SpyObj<PinboardService>;
    plotBoardService = TestBed.inject(PlotBoardService) as jasmine.SpyObj<PlotBoardService>;
    castService = TestBed.inject(CastService) as jasmine.SpyObj<CastService>;
    metadataService = TestBed.inject(MetadataService) as jasmine.SpyObj<MetadataService>;
    loggingService = TestBed.inject(LoggingService) as jasmine.SpyObj<LoggingService>;
  });

  describe('countCharacterReferences', () => {
    it('should count references across all services including pinboards', async () => {
      houseService.countCharacterReferences.and.returnValue(2);
      castService.countCharacterInCasts.and.returnValue(1);
      pinboardService.countCharacterReferences.and.returnValue(3);
      plotBoardService.countCharacterReferences.and.returnValue(Promise.resolve(1));

      const result = await service.countCharacterReferences('char-1');

      expect(result.houses).toBe(2);
      expect(result.casts).toBe(1);
      expect(result.pinboards).toBe(3);
      expect(result.plotBoards).toBe(1);
    });

    it('should return zeros if counting fails', async () => {
      houseService.countCharacterReferences.and.throwError('Database error');

      const result = await service.countCharacterReferences('char-1');

      expect(result.houses).toBe(0);
      expect(result.casts).toBe(0);
      expect(result.pinboards).toBe(0);
      expect(result.plotBoards).toBe(0);
      expect(loggingService.error).toHaveBeenCalled();
    });
  });

  describe('removeCharacterReferences', () => {
    beforeEach(() => {
      metadataService.removeCharacterFromBookPovs.and.returnValue(Promise.resolve());
      castService.removeCharacterFromCasts.and.returnValue(Promise.resolve());
      houseService.removeCharacterFromHouses.and.returnValue(Promise.resolve());
      pinboardService.removeCharacterConnections.and.returnValue(Promise.resolve());
      plotBoardService.removeCharacterFromThreads.and.returnValue(Promise.resolve());
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
  });

  describe('clearLocationReferences', () => {
    it('should clear house references to location', async () => {
      houseService.clearLocationReferences.and.returnValue(Promise.resolve());

      await service.clearLocationReferences('loc-1');

      expect(houseService.clearLocationReferences).toHaveBeenCalledWith('loc-1');
    });

    it('should handle errors gracefully', async () => {
      houseService.clearLocationReferences.and.returnValue(Promise.reject(new Error('House error')));

      await service.clearLocationReferences('loc-1');

      expect(loggingService.error).toHaveBeenCalled();
    });
  });
});
