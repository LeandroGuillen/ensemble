import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, merge, debounceTime, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Backlink,
  BacklinkIndex,
  BacklinkSourceDoc,
  buildBacklinkIndex,
  excludedCountFor,
} from '../utils/backlinks.utils';
import { WikiLinkCollection } from '../utils/wiki-links.utils';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { ProjectService } from './project.service';
import { FileWatcherService } from './file-watcher.service';
import { ElectronService } from './electron.service';
import { LoggingService } from './logging.service';
import { pathJoin } from '../utils/path.utils';
import { CHARACTER_DRAFTS_FOLDER } from '../utils/character-path.utils';
import { Character } from '../interfaces/character.interface';

const EMPTY_INDEX: BacklinkIndex = { byTargetId: {}, excluded: [] };

/**
 * In-memory "Mentioned in" link index.
 *
 * Scans every record description (characters, Lore, drafts, locations, Houses)
 * and every book page / plan for `[[wikilinks]]`, and keeps a reverse map of
 * which documents mention each record. Rebuilds whenever record lists change or
 * a watched file is edited externally (e.g. in Obsidian), so backlinks stay
 * fresh without a manual refresh.
 */
@Injectable({ providedIn: 'root' })
export class BacklinkService {
  private readonly characters = inject(CharacterService);
  private readonly locations = inject(LocationService);
  private readonly houses = inject(HouseService);
  private readonly projects = inject(ProjectService);
  private readonly fileWatcher = inject(FileWatcherService);
  private readonly electron = inject(ElectronService);
  private readonly logger = inject(LoggingService);

  private readonly indexSubject = new BehaviorSubject<BacklinkIndex>(EMPTY_INDEX);
  readonly index$: Observable<BacklinkIndex> = this.indexSubject.asObservable();

  /** Serializes rebuilds so concurrent triggers never interleave reads. */
  private rebuildQueue: Promise<void> = Promise.resolve();

  /**
   * Read an observable from a source service, falling back when the source is
   * unavailable. The backlink index is best-effort: one missing source must not
   * break the index or the pages that render it.
   */
  private safeStream<T>(build: () => Observable<T>, fallback: Observable<T>): Observable<T> {
    try {
      return build() ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Read a value/snapshot from a source service, falling back when unavailable. */
  private safeCall<T>(build: () => T, fallback: T): T {
    try {
      const value = build();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  constructor() {
    // Rebuild when any record list or the project changes. Locations and Houses
    // load lazily, so kick those off on project activation first.
    this.safeStream(() => this.projects.currentProject$, of(null)).pipe(takeUntilDestroyed()).subscribe((project) => {
      if (project) {
        void Promise.all([
          this.locations.loadLocations(project.path),
          this.houses.loadHouses(),
        ]).catch((error) => this.logger.error('Failed to load backlink targets', error));
      }
    });

    merge(
      this.safeStream(() => this.characters.getReferenceCharacters(), of([])),
      this.safeStream(() => this.characters.getDrafts(), of([])),
      this.safeStream(() => this.locations.getLocations(), of([])),
      this.safeStream(() => this.houses.houses$, of([])),
      this.safeStream(() => this.projects.currentProject$, of(null))
    )
      .pipe(debounceTime(80), takeUntilDestroyed())
      .subscribe(() => void this.rebuild());

    // Rebuild on external file edits (book pages and plans the record streams
    // don't reflect, plus any description the subjects missed).
    this.safeStream(() => this.fileWatcher.fileChanges$, of({ type: 'change', path: '', filename: '' }))
      .pipe(debounceTime(80), takeUntilDestroyed())
      .subscribe(() => void this.rebuild());
  }

  /** The current index (synchronously). */
  get index(): BacklinkIndex {
    return this.indexSubject.value;
  }

  /** Documents that mention `targetId`, in scan order. */
  backlinksFor(targetId: string): Backlink[] {
    return this.indexSubject.value.byTargetId[targetId] || [];
  }

  /** Excluded (unresolved/ambiguous) links that look like they refer to this name. */
  excludedCountFor(name: string, aliases: string[] = []): number {
    return excludedCountFor(this.indexSubject.value, name, aliases);
  }

  /** Rebuild the index from current record + book content. */
  rebuild(): Promise<void> {
    this.rebuildQueue = this.rebuildQueue.then(() => this.buildIndex());
    return this.rebuildQueue;
  }

  /** One serialized build pass. */
  private async buildIndex(): Promise<void> {
    try {
      const project = this.safeCall(() => this.projects.getCurrentProject(), null);
      const settings = project?.metadata.settings;
      const reference = this.safeCall(() => this.characters.getReferenceCharactersSnapshot(), []);
      const drafts = this.safeCall(() => this.characters.getDraftsSnapshot(), []);
      const locations = this.safeCall(() => this.locations.getLocationsSnapshot(), []);
      const houses = this.safeCall(() => this.houses.getSnapshot(), []);

      const collections: WikiLinkCollection[] = [
        { targets: reference, folder: settings?.charactersFolder || 'characters', route: 'character', singular: 'Character' },
        { targets: locations, folder: settings?.locationsFolder || 'locations', route: 'location', singular: 'Location' },
        { targets: houses, folder: 'houses', route: 'house', singular: 'House' },
        // Drafts are link targets too, so "Mentioned in" agrees with the editors.
        { targets: drafts, folder: CHARACTER_DRAFTS_FOLDER, route: 'character-draft', singular: 'Draft' },
      ];

      const docs = await this.collectSources(project?.path || null, project?.metadata.books || [], reference, drafts, locations, houses);
      this.indexSubject.next(buildBacklinkIndex(docs, collections));
    } catch (error) {
      this.logger.error('Failed to build backlink index', error);
    }
  }

  /** Gather every scannable document (descriptions + book pages/plans). */
  private async collectSources(
    projectPath: string | null,
    books: { id: string; name: string; code?: string; plan?: { path: string } }[],
    reference: Character[],
    drafts: Character[],
    locations: { id: string; name: string; content: string }[],
    houses: { id: string; name: string; content: string }[]
  ): Promise<BacklinkSourceDoc[]> {
    const docs: BacklinkSourceDoc[] = [];

    for (const character of [...reference, ...drafts]) {
      docs.push({
        sourceType: character.draft ? 'draft' : character.lore ? 'lore' : 'character',
        sourceId: character.id,
        sourceName: character.name,
        href: `#/${character.draft ? 'character-draft' : 'character'}/${encodeURIComponent(character.id)}`,
        content: character.content || '',
      });
    }
    for (const location of locations) {
      docs.push({
        sourceType: 'location',
        sourceId: location.id,
        sourceName: location.name,
        href: `#/location/${encodeURIComponent(location.id)}`,
        content: location.content || '',
      });
    }
    for (const house of houses) {
      docs.push({
        sourceType: 'house',
        sourceId: house.id,
        sourceName: house.name,
        href: `#/house/${encodeURIComponent(house.id)}`,
        content: house.content || '',
      });
    }

    // Character book pages: one plain-markdown page per character per book.
    for (const character of [...reference, ...drafts]) {
      for (const bookId of character.books || []) {
        const bookLabel = this.bookLabel(books, bookId);
        try {
          const content = await this.characters.getBookPageContent(character.id, bookId);
          if (content) {
            docs.push({
              sourceType: 'book',
              sourceId: character.id,
              sourceName: character.name,
              sourcePart: `Book page: ${bookLabel}`,
              href: `#/${character.draft ? 'character-draft' : 'character'}/${encodeURIComponent(character.id)}`,
              content,
            });
          }
        } catch {
          // A missing/unreadable page simply contributes nothing.
        }
      }
    }

    // Book plans (`*.plan.md`) are book content and often carry wiki-links.
    if (projectPath) {
      for (const book of books) {
        if (!book.plan?.path) continue;
        try {
          const result = await this.electron.readFile(pathJoin(projectPath, book.plan.path));
          const content = result.success ? result.content ?? '' : '';
          if (content) {
            docs.push({
              sourceType: 'book',
              sourceId: book.id,
              sourceName: book.name,
              sourcePart: 'Book plan',
              href: `#/book/${encodeURIComponent(book.id)}`,
              content,
            });
          }
        } catch {
          // Unreadable plan contributes nothing.
        }
      }
    }

    return docs;
  }

  private bookLabel(books: { id: string; name: string; code?: string }[], bookId: string): string {
    const book = books.find((b) => b.id === bookId);
    return book?.code || book?.name || bookId;
  }
}
