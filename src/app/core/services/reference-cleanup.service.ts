import { Injectable, Injector } from '@angular/core';
import { HouseService } from './house.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { LoggingService } from './logging.service';

/**
 * Centralized service for cleaning up cross-references when entities are deleted.
 * This avoids circular dependencies between services.
 * 
 * NOTE: PinboardService is resolved lazily via Injector to break the circular
 * dependency (PinboardService -> CharacterService -> ReferenceCleanupService).
 */
@Injectable({
  providedIn: 'root'
})
export class ReferenceCleanupService {
  constructor(
    private houseService: HouseService,
    private plotBoardService: PlotBoardService,
    private castService: CastService,
    private metadataService: MetadataService,
    private logger: LoggingService,
    private injector: Injector
  ) {}

  /**
   * Count how many resources reference a character.
   * Uses lazy injection for PinboardService to avoid circular dependency.
   */
  async countCharacterReferences(characterId: string): Promise<{
    houses: number;
    casts: number;
    pinboards: number;
    plotBoards: number;
  }> {
    try {
      // Lazy-load PinboardService to break circular dependency
      const PinboardService = (await import('./pinboard.service')).PinboardService;
      const pinboardService = this.injector.get(PinboardService);

      const [houseCount, castCount, pinboardCount, plotBoardCount] = await Promise.all([
        this.houseService.countCharacterReferences(characterId),
        this.castService.countCharacterInCasts(characterId),
        pinboardService.countCharacterReferences(characterId),
        this.plotBoardService.countCharacterReferences(characterId),
      ]);

      return {
        houses: houseCount,
        casts: castCount,
        pinboards: pinboardCount,
        plotBoards: plotBoardCount,
      };
    } catch (error) {
      this.logger.error('Failed to count character references', error);
      return { houses: 0, casts: 0, pinboards: 0, plotBoards: 0 };
    }
  }

  /**
   * Remove all references to a character across the project.
   * Uses lazy injection for PinboardService to avoid circular dependency.
   */
  async removeCharacterReferences(characterId: string): Promise<void> {
    const cleanupErrors: string[] = [];

    try {
      await this.metadataService.removeCharacterFromBookPovs(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from book PoVs';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      await this.castService.removeCharacterFromCasts(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from casts';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      await this.houseService.removeCharacterFromHouses(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from houses';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      // Lazy-load PinboardService to break circular dependency
      const PinboardService = (await import('./pinboard.service')).PinboardService;
      const pinboardService = this.injector.get(PinboardService);
      await pinboardService.removeCharacterConnections(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from pinboards';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      await this.plotBoardService.removeCharacterFromThreads(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from plot threads';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    if (cleanupErrors.length > 0) {
      this.logger.warn(`Character deleted but some cleanup steps failed: ${cleanupErrors.join(', ')}`);
    }
  }

  /**
   * Clear house references to a deleted location
   */
  async clearLocationReferences(locationId: string): Promise<void> {
    try {
      await this.houseService.clearLocationReferences(locationId);
    } catch (cleanupError) {
      this.logger.error('Failed to clear location references from houses', cleanupError);
    }
  }
}
