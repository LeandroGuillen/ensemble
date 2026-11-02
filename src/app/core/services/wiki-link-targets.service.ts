import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, tap } from 'rxjs';
import { WikiLinkCollection, WikiLinkTargets, buildWikiLinkTargets } from '../utils/wiki-links.utils';
import { CHARACTER_DRAFTS_FOLDER } from '../utils/character-path.utils';
import { CharacterService } from './character.service';
import { HouseService } from './house.service';
import { LocationService } from './location.service';
import { LoggingService } from './logging.service';
import { ProjectService } from './project.service';

export type WikiLinkRoute = 'character' | 'location' | 'house';

/** [[Wikilink]] targets (characters, drafts, locations, Houses) for the Markdown description editors. */
@Injectable({ providedIn: 'root' })
export class WikiLinkTargetsService {
  private readonly characters = inject(CharacterService);
  private readonly locations = inject(LocationService);
  private readonly houses = inject(HouseService);
  private readonly projects = inject(ProjectService);
  private readonly logger = inject(LoggingService);

  /**
   * Resolver and `[[` suggestions, refreshed whenever any target list changes.
   * `primary` decides which "New …" page a missing link opens.
   */
  targets$(primary: WikiLinkRoute): Observable<WikiLinkTargets> {
    const project$ = this.projects.currentProject$.pipe(
      tap((project) => {
        if (!project) return;
        // Locations and Houses load lazily; links to them should resolve on any page.
        void Promise.all([this.locations.loadLocations(project.path), this.houses.loadHouses()])
          .catch((error) => this.logger.error('Failed to load link targets', error));
      })
    );
    return combineLatest([
      this.characters.getReferenceCharacters(),
      this.characters.getDrafts(),
      this.locations.getLocations(),
      this.houses.houses$,
      project$,
    ]).pipe(
      map(([characters, drafts, locations, houses, project]) => {
        const settings = project?.metadata.settings;
        const collections: WikiLinkCollection[] = [
          { targets: characters, folder: settings?.charactersFolder || 'characters', route: 'character', singular: 'Character' },
          { targets: locations, folder: settings?.locationsFolder || 'locations', route: 'location', singular: 'Location' },
          { targets: houses, folder: 'houses', route: 'house', singular: 'House' },
          // Every existing note is a valid link target (Obsidian-style), so drafts
          // link like any other note; they stay out of all other character consumers.
          { targets: drafts, folder: CHARACTER_DRAFTS_FOLDER, route: 'character-draft', singular: 'Draft' },
        ];
        const primaryIndex = collections.findIndex((collection) => collection.route === primary);
        collections.unshift(...collections.splice(primaryIndex, 1));
        return buildWikiLinkTargets(collections);
      })
    );
  }
}
