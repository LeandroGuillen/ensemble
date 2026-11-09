import { Injectable, Injector } from '@angular/core';
import {
  CharacterReferenceSnapshot,
  HouseCharacterSnapshot,
  LocationReferenceSnapshot,
  PromptLinkSnapshot,
  ReferenceRestoreResult,
  ReferenceRestoreSkip,
} from '../interfaces/reference-snapshot.interface';
import { houseLinkUpdateFailureMessage } from '../utils/house.utils';
import { HouseService } from './house.service';
import { PlotBoardService } from './plot-board.service';
import { CastService } from './cast.service';
import { MetadataService } from './metadata.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';

/**
 * Centralized service for cleaning up cross-references when entities are deleted.
 * This avoids circular dependencies between services.
 *
 * NOTE: PinboardService and PromptService are resolved lazily via Injector to
 * break circular dependencies (both depend on CharacterService, which depends
 * on ReferenceCleanupService).
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
    private notificationService: NotificationService,
    private injector: Injector
  ) {}

  /** Keep a House partial snapshot if a cleanup step threw with one attached. */
  private takePartialHouseSnapshot(error: unknown): HouseCharacterSnapshot | null {
    const partial = (error as { partialSnapshot?: unknown })?.partialSnapshot;
    if (
      partial &&
      typeof partial === 'object' &&
      Array.isArray((partial as HouseCharacterSnapshot).removals)
    ) {
      return partial as HouseCharacterSnapshot;
    }
    return null;
  }

  private takePartialLocationSnapshot(error: unknown): LocationReferenceSnapshot | null {
    const partial = (error as { partialSnapshot?: unknown })?.partialSnapshot;
    if (
      partial &&
      typeof partial === 'object' &&
      Array.isArray((partial as LocationReferenceSnapshot).seats)
    ) {
      return partial as LocationReferenceSnapshot;
    }
    return null;
  }

  private async promptService() {
    const { PromptService } = await import('./prompt.service');
    return this.injector.get(PromptService);
  }

  /** Prompt files linking a character or location; [] (logged) when they cannot be read. */
  private async countPromptLinks(
    field: 'characters' | 'locations',
    targetId: string
  ): Promise<{ id: string; name: string }[]> {
    try {
      return await (await this.promptService()).countLinks(field, targetId);
    } catch (error) {
      this.logger.error('Failed to count prompt links', error);
      return [];
    }
  }

  private async removePromptLinks(
    field: 'characters' | 'locations',
    targetId: string
  ): Promise<PromptLinkSnapshot> {
    return (await this.promptService()).removeLinks(field, targetId);
  }

  /**
   * Stores the name of a character or location about to be deleted, so a
   * prompt link that cannot be cleaned up still shows it. Not best-effort:
   * throws when it cannot be saved, and callers run it before staging so the
   * delete is cancelled with nothing changed.
   */
  async rememberPromptLinkName(
    field: 'characters' | 'locations',
    targetId: string,
    name: string
  ): Promise<void> {
    await (await this.promptService()).rememberDeletedName(field, targetId, name);
  }

  private async restorePromptLinks(snapshot: PromptLinkSnapshot | undefined): Promise<ReferenceRestoreResult> {
    if (!snapshot || snapshot.removals.length === 0) {
      return { restored: 0, skipped: [] };
    }
    return (await this.promptService()).restoreLinks(snapshot);
  }

  private toastFailedHouseLinks(error: unknown): void {
    const names = (error as { failedHouseNames?: unknown })?.failedHouseNames;
    if (!Array.isArray(names) || names.length === 0) {
      return;
    }
    const cleaned = names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    if (cleaned.length === 0) {
      return;
    }
    this.notificationService.showWarning(houseLinkUpdateFailureMessage(cleaned));
  }

  /**
   * Count how many resources reference a character.
   * Uses lazy injection for PinboardService to avoid circular dependency.
   */
  async countCharacterReferences(characterId: string): Promise<{
    houses: { id: string; name: string }[];
    casts: { id: string; name: string }[];
    pinboards: { id: string; name: string }[];
    plotBoards: { id: string; name: string }[];
    prompts: { id: string; name: string }[];
  }> {
    const prompts = await this.countPromptLinks('characters', characterId);
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
        prompts,
      };
    } catch (error) {
      this.logger.error('Failed to count character references', error);
      return { houses: [], casts: [], pinboards: [], plotBoards: [], prompts };
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
      prompts: { field: 'characters', targetId: characterId, removals: [] },
    };
  }

  /** Prompt files linking a draft (drafts have no other references). */
  async countDraftReferences(characterId: string): Promise<{ prompts: { id: string; name: string }[] }> {
    return { prompts: await this.countPromptLinks('characters', characterId) };
  }

  /**
   * Remove a deleted draft's id from prompt files. Drafts are kept out of
   * casts, Houses, pinboards and plot boards, but prompts can link them.
   */
  async removeDraftReferences(characterId: string): Promise<CharacterReferenceSnapshot> {
    const snapshot = this.emptyCharacterSnapshot(characterId);
    // Throws (nothing changed) when a linked prompt file cannot be updated.
    snapshot.prompts = await this.removePromptLinks('characters', characterId);
    return snapshot;
  }

  /**
   * Remove all references to a character across the project.
   * Returns a combined typed snapshot for Undo restore.
   * Throws (nothing changed) when a linked prompt file cannot be updated.
   */
  async removeCharacterReferences(characterId: string): Promise<CharacterReferenceSnapshot> {
    const snapshot = this.emptyCharacterSnapshot(characterId);
    const cleanupErrors: string[] = [];

    // Prompts go first and are not best-effort: a prompt file that cannot be
    // unlinked throws (with its own links put back) before anything else is
    // touched, so the caller cancels the delete instead of leaving a prompt
    // with an anonymous "Missing character" link.
    snapshot.prompts = await this.removePromptLinks('characters', characterId);

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
      const partial = this.takePartialHouseSnapshot(cleanupError);
      if (partial) {
        snapshot.houses = partial;
        this.toastFailedHouseLinks(cleanupError);
      } else {
        const msg = 'Failed to remove character from houses';
        this.logger.error(msg, cleanupError);
        cleanupErrors.push(msg);
      }
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

    try {
      const promptResult = await this.restorePromptLinks(snapshot.prompts);
      restored += promptResult.restored;
      skipped.push(...promptResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore character prompt links', error);
    }

    return { restored, skipped };
  }

  /** Prompt files that link a location (`locations:`), for the delete dialog. */
  async countLocationReferences(locationId: string): Promise<{ prompts: { id: string; name: string }[] }> {
    return { prompts: await this.countPromptLinks('locations', locationId) };
  }

  /**
   * Clear House seats and prompt links pointing at a deleted location.
   * Returns a snapshot for Undo. Throws (nothing changed) when a linked prompt
   * file cannot be updated.
   */
  async clearLocationReferences(locationId: string): Promise<LocationReferenceSnapshot> {
    // Prompts first and not best-effort (see removeCharacterReferences): throws
    // before any House is touched when a linked prompt file cannot be updated.
    const prompts = await this.removePromptLinks('locations', locationId);
    let snapshot: LocationReferenceSnapshot;
    try {
      snapshot = await this.houseService.clearLocationReferences(locationId);
    } catch (cleanupError) {
      const partial = this.takePartialLocationSnapshot(cleanupError);
      if (partial) {
        this.toastFailedHouseLinks(cleanupError);
        snapshot = partial;
      } else {
        this.logger.error('Failed to clear location references from houses', cleanupError);
        snapshot = { locationId, seats: [] };
      }
    }

    return { ...snapshot, prompts };
  }

  /**
   * Restore House seatId values and prompt links from a location-delete snapshot.
   */
  async restoreLocationReferences(snapshot: LocationReferenceSnapshot): Promise<ReferenceRestoreResult> {
    const skipped: ReferenceRestoreSkip[] = [];
    let restored = 0;

    try {
      const houseResult = await this.houseService.restoreLocationReferences(snapshot);
      restored += houseResult.restored;
      skipped.push(...houseResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore location references to houses', error);
    }

    try {
      const promptResult = await this.restorePromptLinks(snapshot.prompts);
      restored += promptResult.restored;
      skipped.push(...promptResult.skipped);
    } catch (error) {
      this.logger.error('Failed to restore location links in prompts', error);
    }

    return { restored, skipped };
  }
}
