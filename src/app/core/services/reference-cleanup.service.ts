import { Injectable, Injector } from '@angular/core';
import {
  CharacterReferenceSnapshot,
  LocationReferenceSnapshot,
  ReferenceRestoreResult,
  ReferenceRestoreSkip,
} from '../interfaces/reference-snapshot.interface';
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
    houses: { id: string; name: string }[];
    casts: { id: string; name: string }[];
    pinboards: { id: string; name: string }[];
    plotBoards: { id: string; name: string }[];
  }> {
    try {
      // Lazy-load PinboardService to break circular dependency
      const PinboardService = (await import('./pinboard.service')).PinboardService;
      const pinboardService = this.injector.get(PinboardService);

      const [houses, casts, pinboards, plotBoards] = await Promise.all([
        this.houseService.countCharacterReferences(characterId),
        this.castService.countCharacterInCasts(characterId),
        pinboardService.countCharacterReferences(characterId),
        this.plotBoardService.countCharacterReferences(characterId),
      ]);

      return {
        houses,
        casts,
        pinboards,
        plotBoards,
      };
    } catch (error) {
      this.logger.error('Failed to count character references', error);
      return { houses: [], casts: [], pinboards: [], plotBoards: [] };
    }
  }

  private emptyCharacterSnapshot(characterId: string): CharacterReferenceSnapshot {
    return {
      characterId,
      bookPovs: { characterId, removals: [] },
      casts: { characterId, removals: [] },
      houses: { characterId, removals: [] },
      pinboards: { characterId, removals: [] },
      plotThreads: { characterId, removals: [] },
    };
  }

  /**
   * Remove all references to a character across the project.
   * Returns a combined typed snapshot for Undo restore.
   */
  async removeCharacterReferences(characterId: string): Promise<CharacterReferenceSnapshot> {
    const snapshot = this.emptyCharacterSnapshot(characterId);
    const cleanupErrors: string[] = [];

    try {
      snapshot.bookPovs = await this.metadataService.removeCharacterFromBookPovs(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from book PoVs';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      snapshot.casts = await this.castService.removeCharacterFromCasts(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from casts';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      snapshot.houses = await this.houseService.removeCharacterFromHouses(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from houses';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      const PinboardService = (await import('./pinboard.service')).PinboardService;
      const pinboardService = this.injector.get(PinboardService);
      snapshot.pinboards = await pinboardService.removeCharacterConnections(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from pinboards';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    try {
      snapshot.plotThreads = await this.plotBoardService.removeCharacterFromThreads(characterId);
    } catch (cleanupError) {
      const msg = 'Failed to remove character from plot threads';
      this.logger.error(msg, cleanupError);
      cleanupErrors.push(msg);
    }

    if (cleanupErrors.length > 0) {
      this.logger.warn(`Character deleted but some cleanup steps failed: ${cleanupErrors.join(', ')}`);
    }

    return snapshot;
  }

  /**
   * Reapply a character reference snapshot. Skips missing targets; never fails the whole restore.
   */
  async restoreCharacterReferences(snapshot: CharacterReferenceSnapshot): Promise<ReferenceRestoreResult> {
    const skipped: ReferenceRestoreSkip[] = [];
    let restored = 0;

    if (!snapshot) {
      return { restored, skipped };
    }

    try {
      const bookResult = await this.metadataService.restoreCharacterToBookPovs(snapshot.bookPovs);
      restored += bookResult.restored;
      skipped.push(...bookResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore character book PoVs', error);
    }

    try {
      const castResult = await this.castService.restoreCharacterToCasts(snapshot.casts);
      restored += castResult.restored;
      skipped.push(...castResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore character casts', error);
    }

    try {
      const houseResult = await this.houseService.restoreCharacterToHouses(snapshot.houses);
      restored += houseResult.restored;
      skipped.push(...houseResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore character houses', error);
    }

    try {
      const PinboardService = (await import('./pinboard.service')).PinboardService;
      const pinboardService = this.injector.get(PinboardService);
      const pinboardResult = await pinboardService.restoreCharacterConnections(snapshot.pinboards);
      restored += pinboardResult.restored;
      skipped.push(...pinboardResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore character pinboards', error);
    }

    try {
      const plotResult = await this.plotBoardService.restoreCharacterToThreads(snapshot.plotThreads);
      restored += plotResult.restored;
      skipped.push(...plotResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore character plot threads', error);
    }

    return { restored, skipped };
  }

  /**
   * Clear house references to a deleted location. Returns seatId snapshot for Undo.
   */
  async clearLocationReferences(locationId: string): Promise<LocationReferenceSnapshot> {
    try {
      return await this.houseService.clearLocationReferences(locationId);
    } catch (cleanupError) {
      this.logger.error('Failed to clear location references from houses', cleanupError);
      return { locationId, seats: [] };
    }
  }

  /**
   * Restore House seatId values from a location-delete snapshot.
   */
  async restoreLocationReferences(snapshot: LocationReferenceSnapshot): Promise<ReferenceRestoreResult> {
    try {
      return await this.houseService.restoreLocationReferences(snapshot);
    } catch (error) {
      this.logger.error('Failed to restore location references to houses', error);
      return { restored: 0, skipped: [] };
    }
  }
}
