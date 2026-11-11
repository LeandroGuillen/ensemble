import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, distinctUntilChanged, map, shareReplay, tap } from 'rxjs';
import { WikiLinkCollection, WikiLinkRecordName, WikiLinkTargets, buildWikiLinkRecordName, buildWikiLinkTargets } from '../utils/wiki-links.utils';
import { normalizeAliases } from '../utils/character-alias.utils';
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
  private recordNames$?: Observable<WikiLinkRecordName>;

  /**
   * How the resolver reads each link target's record name (`[[C#]]` -> `C#` when such a record
   * exists), shared by every list preview so cards show the name the link opens.
   */
  recordName$(): Observable<WikiLinkRecordName> {
    return this.recordNames$ ??= this.collections$('character').pipe(
      // Save/body/book/settings emissions do not change how any preview reads a name.
      // Capture values rather than array identities: services may replace or mutate records.
      map(collections => ({ collections, key: JSON.stringify(collections.map(collection => [
        collection.folder,
        collection.targets.map(entry => [entry.name, entry.relativePath, normalizeAliases(entry.aliases)]),
      ])) })),
      distinctUntilChanged((before, after) => before.key === after.key),
      map(({ collections }) => buildWikiLinkRecordName(collections)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Resolver and `[[` suggestions, refreshed whenever any target list changes.
   * `primary` decides which "New …" page a missing link opens.
   */
  targets$(primary: WikiLinkRoute): Observable<WikiLinkTargets> {
    return this.collections$(primary).pipe(map(collections => buildWikiLinkTargets(collections)));
  }

  private collections$(primary: WikiLinkRoute): Observable<WikiLinkCollection[]> {
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
          // Their paths are relative to the characters folder (`characters/@drafts/x/x`), and a
          // published character with the same name wins the bare name (`secondary`).
          { targets: drafts, folder: settings?.charactersFolder || 'characters', route: 'character-draft', singular: 'Draft', secondary: true },
        ];
        const primaryIndex = collections.findIndex((collection) => collection.route === primary);
        collections.unshift(...collections.splice(primaryIndex, 1));
        return collections;
      })
    );
  }
}
