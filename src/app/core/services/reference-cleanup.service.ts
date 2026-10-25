import { Injectable } from '@angular/core';
import { HouseService } from './house.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { LoggingService } from './logging.service';

/**
 * Centralized service for cleaning up cross-references when entities are deleted.
 * This avoids circular dependencies between services.
 * 
 * NOTE: PinboardService is excluded because it depends on CharacterService,
 * which would create a circular dependency. Character deletion calls
 * PinboardService.removeCharacterConnections directly instead.
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
    private logger: LoggingService
  ) {}

  /**
   * Count how many resources reference a character.
   * NOTE: Pinboard count must be provided by the caller since PinboardService
   * creates a circular dependency.
   */
  async countNonPinboardReferences(characterId: string): Promise<{
    houses: number;
    casts: number;
    plotBoards: number;
  }> {
    try {
      const [houseCount, castCount, plotBoardCount] = await Promise.all([
        this.houseService.countCharacterReferences(characterId),
        this.castService.countCharacterInCasts(characterId),
        this.plotBoardService.countCharacterReferences(characterId),
      ]);

      return {
        houses: houseCount,
        casts: castCount,
        plotBoards: plotBoardCount,
      };
    } catch (error) {
      this.logger.error('Failed to count character references', error);
      return { houses: 0, casts: 0, plotBoards: 0 };
    }
  }

  /**
   * Remove all references to a character from non-pinboard resources.
   * NOTE: Pinboard cleanup must be called separately by the caller since
   * PinboardService creates a circular dependency.
   */
  async removeNonPinboardReferences(characterId: string): Promise<void> {
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
