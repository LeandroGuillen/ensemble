import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, combineLatest, distinctUntilChanged, map, shareReplay } from 'rxjs';
import { ParsedBookPlan } from '../interfaces/book-plan.interface';
import { Character } from '../interfaces/character.interface';
import { House } from '../interfaces/house.interface';
import { Location } from '../interfaces/location.interface';
import { Book, Project } from '../interfaces/project.interface';
import { parseBookPlan, setChapterWhen } from '../utils/book-plan.utils';
import {
  ChronicleEntryDraft,
  ParsedChronicle,
  insertChronicleEntry,
  newChronicleText,
  parseChronicle,
  removeChronicleEntry,
  replaceChronicleEntry,
} from '../utils/chronicle-file.utils';
import { pathJoin } from '../utils/path.utils';
import { LinkResolver } from '../utils/timeline.utils';
import { WorldCalendar, resolveCalendar } from '../utils/world-date.utils';
import { BookPlanService } from './book-plan.service';
import { CharacterService } from './character.service';
import { HouseService } from './house.service';
import { LocationService } from './location.service';
import { WikiLinkTargetsService } from './wiki-link-targets.service';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { ProjectService } from './project.service';

export const DEFAULT_CHRONICLE_FILE = 'chronicle.md';

export interface ChronicleState {
  /** Relative to the project root. */
  relativePath: string;
  exists: boolean;
  text: string;
  parsed: ParsedChronicle;
  error: string | null;
}

/** Everything a timeline view needs, in one emission. */
export interface TimelineContext {
  projectName: string;
  calendar: WorldCalendar;
  chronicle: ChronicleState | null;
  plans: ReadonlyMap<string, ParsedBookPlan>;
  /** Active characters and Lore figures. */
  characters: Character[];
  charactersById: ReadonlyMap<string, Character>;
  houses: House[];
  locations: Location[];
  locationsById: ReadonlyMap<string, Location>;
  books: Book[];
  resolve: LinkResolver;
}

export interface TimelinePlan {
  bookId: string;
  relativePath: string;
  parsed: ParsedBookPlan;
}

/**
 * Data for the Timeline (Chronicle, Lifelines) and the book page's story time:
 * the chronicle file, every book's plan (read-only here; the open plan comes live from
 * BookPlanService) and the project calendar. Keeps all of it in sync with the disk.
 */
@Injectable({ providedIn: 'root' })
export class TimelineService {
  private readonly electron = inject(ElectronService);
  private readonly projects = inject(ProjectService);
  private readonly watcher = inject(FileWatcherService);
  private readonly bookPlan = inject(BookPlanService);
  private readonly logger = inject(LoggingService);

  private readonly chronicleSubject = new BehaviorSubject<ChronicleState | null>(null);
  readonly chronicle$ = this.chronicleSubject.asObservable();
  /** Plans read from disk, by book id. */
  private readonly diskPlans = new BehaviorSubject<ReadonlyMap<string, TimelinePlan>>(new Map());

  readonly calendar$: Observable<WorldCalendar> = this.projects.currentProject$.pipe(
    map((project) => resolveCalendar(project?.metadata.settings.calendar)),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Every book's parsed plan; the plan open on the book page is used live, unsaved edits included. */
  readonly plans$: Observable<ReadonlyMap<string, ParsedBookPlan>> = combineLatest([this.diskPlans, this.bookPlan.state$]).pipe(
    map(([plans, open]) => {
      const out = new Map<string, ParsedBookPlan>();
      for (const [bookId, plan] of plans) out.set(bookId, plan.parsed);
      if (open && !open.error) out.set(open.bookId, open.parsed);
      return out;
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  private readonly characterService = inject(CharacterService);
  private readonly houseService = inject(HouseService);
  private readonly locationService = inject(LocationService);
  private readonly linkTargets = inject(WikiLinkTargetsService);

  /** Records, files and link resolution combined; loads the chronicle and plans on first use. */
  readonly context$: Observable<TimelineContext> = combineLatest([
    this.projects.currentProject$,
    this.calendar$,
    this.chronicle$,
    this.plans$,
    this.characterService.getReferenceCharacters(),
    this.houseService.houses$,
    this.locationService.getLocations(),
    this.linkTargets.targets$('character'),
  ]).pipe(
    map(([project, calendar, chronicle, plans, characters, houses, locations, targets]) => {
      if (project && !this.loading && this.sourcesKey !== sourcesKey(project)) void this.load();
      return {
        projectName: project?.metadata.projectName ?? '',
        calendar,
        chronicle,
        plans,
        characters,
        charactersById: new Map(characters.map((c) => [c.id, c])),
        houses,
        locations,
        locationsById: new Map(locations.map((l) => [l.id, l])),
        books: project?.metadata.books ?? [],
        resolve: targets.resolve,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private projectPath: string | null = null;
  /** Signature of the files to read (chronicle path + plan paths) to reload only when they change. */
  private sourcesKey = '';
  private loading: Promise<void> | null = null;
  private writing: Promise<unknown> = Promise.resolve();

  constructor() {
    this.projects.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      if (project?.path !== this.projectPath) {
        this.projectPath = project?.path ?? null;
        this.sourcesKey = '';
        this.chronicleSubject.next(null);
        this.diskPlans.next(new Map());
      }
      if (project && this.sourcesKey && this.sourcesKey !== sourcesKey(project)) {
        void this.load();
      }
    });
    this.watcher.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => void this.onFileChange(event));
  }

  /** Load the chronicle and plans once per project (and again when their paths change). */
  ensureLoaded(): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project) return Promise.resolve();
    if (this.sourcesKey === sourcesKey(project) && this.chronicleSubject.value) return Promise.resolve();
    return this.load();
  }

  /** Re-read external edits even when this project's sources are already loaded. */
  async refresh(): Promise<void> {
    if (this.loading) await this.loading;
    await this.load();
  }

  chronicleRelativePath(project: Project | null = this.projects.getCurrentProject()): string {
    return chronicleRelativePath(project);
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const project = this.projects.getCurrentProject();
      if (!project) return;
      this.sourcesKey = sourcesKey(project);
      await Promise.all([this.loadChronicle(), this.loadPlans()]);
    })()
      .catch((error) => this.logger.error('Failed to load timeline data', error))
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async loadChronicle(): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project) return;
    const calendar = resolveCalendar(project.metadata.settings.calendar);
    const relativePath = chronicleRelativePath(project);
    const absolute = pathJoin(project.path, relativePath);
    const exists = await this.electron.fileExists(absolute);
    if (!exists) {
      this.chronicleSubject.next({ relativePath, exists: false, text: '', parsed: parseChronicle('', calendar), error: null });
      return;
    }
    const read = await this.electron.readFile(absolute);
    if (this.projects.getCurrentProject()?.path !== project.path) return;
    const text = read.success ? read.content ?? '' : '';
    this.chronicleSubject.next({
      relativePath,
      exists: true,
      text,
      parsed: parseChronicle(text, calendar),
      error: read.success ? null : `Could not read ${relativePath}${read.error ? `: ${read.error}` : ''}`,
    });
  }

  private async loadPlans(): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project) return;
    const plans = new Map<string, TimelinePlan>();
    await Promise.all(
      (project.metadata.books || []).map(async (book) => {
        const relativePath = book.plan?.path?.trim();
        if (!relativePath) return;
        const read = await this.electron.readFile(pathJoin(project.path, relativePath));
        if (read.success) plans.set(book.id, { bookId: book.id, relativePath, parsed: parseBookPlan(read.content ?? '') });
      })
    );
    if (this.projects.getCurrentProject()?.path === project.path) this.diskPlans.next(plans);
  }

  private async onFileChange(event: FileChangeEvent): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project || !this.sourcesKey) return;
    const path = normalize(event.path);
    const chronicle = this.chronicleSubject.value;
    if (chronicle && path === normalize(pathJoin(project.path, chronicle.relativePath))) {
      if (event.type === 'unlink' || !chronicle.exists || (await this.diskText(chronicle.relativePath)) !== chronicle.text) {
        await this.loadChronicle();
      }
      return;
    }
    const book = (project.metadata.books || []).find(
      (b) => b.plan?.path?.trim() && path === normalize(pathJoin(project.path, b.plan.path.trim()))
    );
    if (!book) return;
    const plans = new Map(this.diskPlans.value);
    const read = event.type === 'unlink' ? null : await this.electron.readFile(event.path);
    if (read?.success) plans.set(book.id, { bookId: book.id, relativePath: book.plan!.path.trim(), parsed: parseBookPlan(read.content ?? '') });
    else plans.delete(book.id);
    this.diskPlans.next(plans);
  }

  private async diskText(relativePath: string): Promise<string | null> {
    const project = this.projects.getCurrentProject();
    if (!project) return null;
    const read = await this.electron.readFile(pathJoin(project.path, relativePath));
    return read.success ? read.content ?? '' : null;
  }

  // ------------------------------------------------------------ chronicle writes

  /** Create the chronicle file with a starter heading. */
  async createChronicle(): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project) throw new Error('No project loaded');
    const relativePath = chronicleRelativePath(project);
    const absolute = pathJoin(project.path, relativePath);
    if (await this.electron.fileExists(absolute)) {
      await this.loadChronicle();
      return;
    }
    await this.write(absolute, newChronicleText(project.metadata.projectName));
    await this.loadChronicle();
  }

  /** Add an entry in date order; returns its heading line. */
  addEntry(draft: ChronicleEntryDraft, eraIndex?: number): Promise<number> {
    return this.mutateChronicle((text, calendar) => insertChronicleEntry(text, draft, calendar, eraIndex));
  }

  /** Replace the entry whose heading is at `line` (from the current parse). Returns its new line. */
  updateEntry(line: number, draft: ChronicleEntryDraft): Promise<number> {
    return this.mutateChronicle((text, calendar) => replaceChronicleEntry(text, line, draft, calendar));
  }

  async removeEntry(line: number): Promise<void> {
    await this.mutateChronicle((text, calendar) => ({ text: removeChronicleEntry(text, line, calendar), line: -1 }));
  }

  /**
   * Apply an edit to the chronicle text and write it. Refuses (and reloads) when the file
   * changed on disk since it was read, so external edits are never overwritten.
   */
  private mutateChronicle(edit: (text: string, calendar: WorldCalendar) => { text: string; line: number }): Promise<number> {
    const run = async (): Promise<number> => {
      const project = this.projects.getCurrentProject();
      if (!project) throw new Error('No project loaded');
      await this.ensureLoaded();
      let state = this.chronicleSubject.value!;
      if (!state.exists) {
        await this.createChronicle();
        state = this.chronicleSubject.value!;
      }
      const disk = await this.diskText(state.relativePath);
      if (disk !== null && disk !== state.text) {
        await this.loadChronicle();
        throw new Error(`${state.relativePath} changed on disk. The latest version is now shown; try again.`);
      }
      const calendar = resolveCalendar(project.metadata.settings.calendar);
      const result = edit(state.text, calendar);
      await this.write(pathJoin(project.path, state.relativePath), result.text);
      this.chronicleSubject.next({ ...state, exists: true, text: result.text, parsed: parseChronicle(result.text, calendar), error: null });
      return result.line;
    };
    const next = this.writing.then(run, run);
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async write(absolute: string, text: string): Promise<void> {
    const result = await this.electron.writeFileAtomic(absolute, text);
    if (!result.success) throw new Error(result.error || 'Could not save the chronicle');
  }

  // ------------------------------------------------------------ plan writes

  /**
   * Set a chapter's `When:` line. The plan open on the book page is edited through
   * BookPlanService (it autosaves); other plans are written directly.
   */
  async setChapterWhen(bookId: string, chapterLine: number, value: string): Promise<void> {
    const open = this.bookPlan.snapshot;
    if (open?.bookId === bookId && !open.error) {
      const chapter = open.parsed.chapters.find((c) => c.line === chapterLine);
      if (!chapter) throw new Error('That chapter is no longer in the plan.');
      this.bookPlan.update(setChapterWhen(open.text, chapter, value));
      return;
    }
    const project = this.projects.getCurrentProject();
    const book = project?.metadata.books.find((b) => b.id === bookId);
    const relativePath = book?.plan?.path?.trim();
    if (!project || !relativePath) throw new Error('This book has no plan file.');
    const absolute = pathJoin(project.path, relativePath);
    const read = await this.electron.readFile(absolute);
    if (!read.success) throw new Error(read.error || `Could not read ${relativePath}`);
    const parsed = parseBookPlan(read.content ?? '');
    const chapter = parsed.chapters.find((c) => c.line === chapterLine);
    if (!chapter) throw new Error('That chapter is no longer in the plan.');
    const text = setChapterWhen(read.content ?? '', chapter, value);
    await this.write(absolute, text);
    const plans = new Map(this.diskPlans.value);
    plans.set(bookId, { bookId, relativePath, parsed: parseBookPlan(text) });
    this.diskPlans.next(plans);
  }
}

export function chronicleRelativePath(project: Project | null): string {
  return project?.metadata.settings.chronicleFile?.trim() || DEFAULT_CHRONICLE_FILE;
}

function sourcesKey(project: Project): string {
  const plans = (project.metadata.books || []).map((b) => `${b.id}=${b.plan?.path ?? ''}`).join('|');
  return `${chronicleRelativePath(project)}#${JSON.stringify(project.metadata.settings.calendar ?? null)}#${plans}`;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}
