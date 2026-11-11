import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, merge, Subject, debounceTime } from 'rxjs';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { PlotBoardService } from './plot-board.service';
import { TextDocument, TextSearchIndex, SearchWorkSlice } from '../utils/text-search.utils';
import { pathJoin } from '../utils/path.utils';
import { LoggingService } from './logging.service';

@Injectable({ providedIn: 'root' })
export class TextSearchService {
  private readonly characters = inject(CharacterService);
  private readonly locations = inject(LocationService);
  private readonly houses = inject(HouseService);
  private readonly projects = inject(ProjectService);
  private readonly electron = inject(ElectronService);
  private readonly watcher = inject(FileWatcherService);
  private readonly boards = inject(PlotBoardService);
  private readonly logger = inject(LoggingService);
  readonly index = new TextSearchIndex();
  readonly changed$ = new Subject<void>();
  readonly loading$ = new BehaviorSubject(false);
  readonly error$ = new BehaviorSubject('');
  private generation = 0;
  private projectPath: string | null = null;
  private reads = new Map<string, string | null>();
  private sections = new Map<string, { text: string; documents: TextDocument[] }>();
  private dirty = new Map<string, number>();
  private revision = 0;
  private boardPaths: string[] | null = null;
  private readonly refresh$ = new Subject<void>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.generation++);
    this.projects.currentProject$.pipe(takeUntilDestroyed()).subscribe(project => {
      // Clear synchronously so a project switch cannot expose the previous project.
      this.generation++;
      if ((project?.path ?? null) !== this.projectPath) {
        this.projectPath = project?.path ?? null;
        this.loading$.next(false);
        this.error$.next('');
        this.reads.clear();
        this.sections.clear();
        this.dirty.clear();
        this.boardPaths = null;
        this.index.replace([]);
        this.changed$.next();
      }
      this.refresh$.next();
    });
    this.watcher.fileChanges$.pipe(takeUntilDestroyed()).subscribe(event => this.invalidate(event.path));
    this.electron.filesWritten$.pipe(takeUntilDestroyed()).subscribe(path => this.invalidate(path));
    merge(this.characters.characters$, this.characters.lore$, this.characters.drafts$,
      this.locations.locations$, this.houses.houses$, this.refresh$)
      .pipe(debounceTime(25), takeUntilDestroyed()).subscribe(() => void this.rebuild());
    this.refresh$.next();
  }

  private invalidate(path: string): void {
    path = pathJoin(path);
    const root = this.projectPath ? pathJoin(this.projectPath) + '/' : '';
    if (!root || !path.startsWith(root) || !path.endsWith('.md') ||
      path.slice(root.length).split('/').some(part => part.startsWith('.'))) return;
    this.dirty.set(path, ++this.revision);
    this.refresh$.next();
  }

  /** Reconcile in idle-sized chunks; unchanged sources and normalized pages are reused.
   * Publish atomically, and keep invalidations until their generation succeeds. */
  async rebuild(): Promise<void> {
    const generation = ++this.generation;
    const project = this.projects.getCurrentProject();
    if (!project) return;
    this.loading$.next(true);
    this.error$.next('');
    const dirty = new Map(this.dirty);
    const reads = new Map<string, string | null>();
    const sections = new Map<string, { text: string; documents: TextDocument[] }>();
    const slice = new SearchWorkSlice();
    try {
      const documents: TextDocument[] = [];
      const records = [...this.characters.getReferenceCharactersSnapshot(), ...this.characters.getDraftsSnapshot()];
      const jobs: (() => Promise<void>)[] = [];
      const read = async (path: string): Promise<string | null> => {
        path = pathJoin(path);
        if (this.reads.has(path) && !dirty.has(path)) {
          const text = this.reads.get(path)!;
          reads.set(path, text);
          return text;
        }
        const result = await this.electron.readFile(path);
        const text = result.success ? result.content ?? '' : null;
        reads.set(path, text);
        return text;
      };
      const appendSections = async (path: string, parse: (text: string) => Promise<TextDocument[]>) => {
        const text = await read(path);
        if (text === null) return;
        const previous = this.sections.get(path);
        const pages = previous?.text === text ? previous.documents : await parse(text);
        sections.set(path, { text, documents: pages });
        for (const page of pages) {
          if (slice.expired()) await slice.yield();
          documents.push(page);
        }
      };
      for (const record of records) {
        if (slice.expired()) await slice.yield();
        if (generation !== this.generation) return;
        const type = record.draft ? 'Drafts' : record.lore ? 'Lore' : 'Characters';
        const route = [record.draft ? '/character-draft' : '/character', record.id];
        const queryParams = record.lore ? { lore: 'true' } : undefined;
        documents.push({ id: record.filePath, type, title: record.name, text: record.content, route, queryParams });
        for (const bookId of record.books) {
          jobs.push(async () => {
            const path = this.characters.getBookPageFilePath(record, bookId);
            const text = await read(path);
            if (text !== null) documents.push({ id: path, type, title: record.name, text, route,
              queryParams: { ...queryParams, book: bookId },
              book: project.metadata.books.find(book => book.id === bookId)?.name || bookId });
          });
        }
      }
      for (const record of this.locations.getLocationsSnapshot()) {
        if (slice.expired()) await slice.yield();
        documents.push({ id: record.filePath, type: 'Locations', title: record.name, text: record.content,
          route: ['/location', record.id] });
      }
      for (const record of this.houses.getSnapshot()) {
        if (slice.expired()) await slice.yield();
        documents.push({ id: record.filePath, type: 'Houses', title: record.name,
          text: [record.content, record.motto, ...record.leadership.map(reign => reign.notes)].join('\n'),
          route: ['/house', record.id] });
      }
      // Backstage files have no frontmatter. Read them directly so external edits
      // are searchable even when the backstage page has never been visited.
      for (const [path, type, route] of [
        [pathJoin(this.projects.getCharactersFolderPath(), 'concepts.md'), 'Concepts', '/concepts'],
        [this.projects.getNamesFilePath(), 'Name lists', '/names'],
      ] as const) {
        jobs.push(() => appendSections(path, async text => {
          const pages: TextDocument[] = [];
          const heading = type === 'Name lists' && /^## /m.test(text) ? /^## /m : /^# /m;
          for (const [i, section] of text.split(heading).filter(section => section.trim()).entries()) {
            if (slice.expired()) await slice.yield();
            const [title, ...body] = section.trim().split('\n');
            pages.push({ id: `${path}#${i}`, type, title, text: body.join('\n'), route: [route] });
          }
          return pages;
        }));
      }
      const boardPaths = new Set(this.boardPaths ?? await this.boards.discoverPlotboardFiles());
      for (const path of dirty.keys()) {
        if (path.startsWith(pathJoin(project.path) + '/') && /\.(pinboard|plotboard)\.md$/.test(path)) {
          boardPaths.add(path.slice(pathJoin(project.path).length + 1));
        }
      }
      for (const relative of boardPaths) {
        if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) continue;
        jobs.push(() => appendSections(pathJoin(project.path, relative), async text => {
          const pages: TextDocument[] = [];
          const board = this.boards.parseFile(text);
          for (const [row, cells] of Object.entries(board.cells)) {
            for (const [thread, cell] of Object.entries(cells)) {
              if (slice.expired()) await slice.yield();
              if (!cell.trim()) continue;
              const threadName = board.threads.find(item => item.id === thread)?.name || thread;
              pages.push({ id: `${relative}#${row}#${thread}`, type: 'Plot boards',
                title: `${relative} · ${row} · ${threadName}`, text: cell,
                route: ['/plot-board', ...relative.split('/')] });
            }
          }
          return pages;
        }));
      }
      // Bound IPC concurrency for larger projects.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(12, jobs.length) }, async () => {
        while (next < jobs.length) {
          if (generation !== this.generation) return;
          const job = jobs[next++];
          if (slice.expired()) await slice.yield();
          if (generation !== this.generation) return;
          await job();
        }
      }));
      if (generation !== this.generation) return;
      documents.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
      if (!await this.index.reconcile(documents, () => generation === this.generation) ||
        generation !== this.generation) return;
      this.reads = reads;
      this.sections = sections;
      this.boardPaths = [...boardPaths];
      for (const [path, revision] of dirty) {
        if (this.dirty.get(path) === revision) this.dirty.delete(path);
      }
      this.changed$.next();
    } catch (error) {
      if (generation === this.generation) this.error$.next('Could not refresh text search. Try reopening search.');
      this.logger.error('Failed to build text search index', error);
    } finally {
      if (generation === this.generation) this.loading$.next(false);
    }
  }
}
