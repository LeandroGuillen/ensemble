import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Character } from '../interfaces/character.interface';
import { normalizeAliases } from '../utils/character-alias.utils';
import { nextCopyName } from '../utils/copy-name.utils';
import { CharacterDuplicateNoticeService } from './character-duplicate-notice.service';
import { CharacterService } from './character.service';
import { HouseService } from './house.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { NotificationService } from './notification.service';
import { ProjectService } from './project.service';

/** Router state set on the copy's page so it can focus the name and explain what was not copied. */
export interface DuplicatedCharacterState {
  duplicatedFrom: string;
}

/**
 * The Duplicate action shared by the character page, the list views and the
 * command palette: picks a unique "(copy)" name, duplicates, and opens the copy.
 */
@Injectable({ providedIn: 'root' })
export class CharacterDuplicateService {
  private readonly characters = inject(CharacterService);
  private readonly locations = inject(LocationService);
  private readonly houses = inject(HouseService);
  private readonly projects = inject(ProjectService);
  private readonly notifications = inject(NotificationService);
  private readonly logger = inject(LoggingService);
  private readonly router = inject(Router);
  private readonly notices = inject(CharacterDuplicateNoticeService);
  private inFlight = false;

  /** Duplicates and navigates to the copy. Returns null (after an error toast) on failure. */
  async duplicate(character: Character): Promise<Character | null> {
    if (this.inFlight) return null;
    this.inFlight = true;
    try {
      const projectPath = this.projects.getCurrentProject()?.path;
      const name = nextCopyName(character.name, await this.takenNames());
      const copy = await this.characters.duplicateCharacter(character.id, name);
      const state: DuplicatedCharacterState = { duplicatedFrom: character.name || 'Untitled draft' };
      if (projectPath) this.notices.remember(projectPath, copy.id, state.duplicatedFrom);
      this.notifications.showSuccess(
        copy.name ? `Created “${copy.name}”.` : `Created a copy of “${state.duplicatedFrom}”.`
      );
      const opened = await this.router.navigate([copy.draft ? '/character-draft' : '/character', copy.id], { state });
      if (!opened) {
        this.logger.warn('Duplicate created but navigation to the copy was cancelled', copy.id);
      }
      return copy;
    } catch (error) {
      this.logger.error('Duplicate character failed', error);
      this.notifications.showError(
        error instanceof Error ? error.message : `Failed to duplicate character: ${error}`
      );
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  /** Names, aliases and wikilink stems of every link target, so the copy's name never makes a link ambiguous. */
  private async takenNames(): Promise<string[]> {
    const projectPath = this.projects.getCurrentProject()?.path;
    if (projectPath) {
      // Locations and Houses load lazily; make sure their names are known.
      await Promise.all([this.locations.loadLocations(projectPath), this.houses.loadHouses()]).catch(
        (error) => this.logger.error('Failed to load link targets for duplicate', error)
      );
    }
    const stem = (relativePath: string) =>
      (relativePath || '').replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '');
    return [
      ...this.characters.getRecordNames(),
      ...this.locations.getLocationsSnapshot().flatMap((location) => [location.name, ...normalizeAliases(location.aliases), stem(location.relativePath)]),
      ...this.houses.getSnapshot().flatMap((house) => [house.name, ...normalizeAliases(house.aliases), stem(house.relativePath)]),
    ];
  }
}
