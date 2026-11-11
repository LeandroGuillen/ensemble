import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, merge, Subject, debounceTime } from 'rxjs';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { PlotBoardService } from './plot-board.service';
import { TextDocument, TextSearchIndex } from '../utils/text-search.utils';
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
  private readonly refresh$ = new Subject<void>();

  constructor() {
    this.projects.currentProject$.pipe(takeUntilDestroyed()).subscribe(project => {
      // Clear synchronously so a project switch cannot expose the previous project.
      this.generation++;
      if ((project?.path ?? null) !== this.projectPath) {
        this.projectPath = project?.path ?? null;
        this.loading$.next(false);
        this.error$.next('');
        this.index.replace([]);
        this.changed$.next();
      }
      this.refresh$.next();
    });
    merge(this.characters.characters$, this.characters.lore$, this.characters.drafts$,
      this.locations.locations$, this.houses.houses$, this.watcher.fileChanges$,
      this.electron.filesWritten$, this.refresh$)
      .pipe(debounceTime(100), takeUntilDestroyed()).subscribe(() => void this.rebuild());
    this.refresh$.next();
  }

  /** Rebuild off to the side, publishing only the newest complete snapshot. */
  async rebuild(): Promise<void> {
    const generation = ++this.generation;
    const project = this.projects.getCurrentProject();
    if (!project) return;
    this.loading$.next(true);
    this.error$.next('');
    try {
      const documents: TextDocument[] = [];
      const records = [...this.characters.getReferenceCharactersSnapshot(), ...this.characters.getDraftsSnapshot()];
      const jobs: (() => Promise<void>)[] = [];
      const read = async (path: string): Promise<string | null> => {
        const result = await this.electron.readFile(path);
        return result.success ? result.content ?? '' : null;
      };
      for (const record of records) {
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
        documents.push({ id: record.filePath, type: 'Locations', title: record.name, text: record.content,
          route: ['/location', record.id] });
      }
      for (const record of this.houses.getSnapshot()) {
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
        jobs.push(async () => {
          const text = await read(path);
          if (!text) return;
          const heading = type === 'Name lists' && /^## /m.test(text) ? /^## /m : /^# /m;
          text.split(heading).filter(section => section.trim()).forEach((section, i) => {
            const [title, ...body] = section.trim().split('\n');
            documents.push({ id: `${path}#${i}`, type, title, text: body.join('\n'), route: [route] });
          });
        });
      }
      for (const relative of await this.boards.discoverPlotboardFiles()) {
        if (relative.split(/[\\/]/).some(part => part.startsWith('.'))) continue;
        jobs.push(async () => {
          const text = await read(pathJoin(project.path, relative));
          if (text === null) return;
          const board = this.boards.parseFile(text);
          for (const [row, cells] of Object.entries(board.cells)) {
            for (const [thread, cell] of Object.entries(cells)) {
              if (!cell.trim()) continue;
              const threadName = board.threads.find(item => item.id === thread)?.name || thread;
              documents.push({ id: `${relative}#${row}#${thread}`, type: 'Plot boards',
                title: `${relative} · ${row} · ${threadName}`, text: cell,
                route: ['/plot-board', ...relative.split('/')] });
            }
          }
        });
      }
      // Bound IPC concurrency for larger projects.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(12, jobs.length) }, async () => {
        while (next < jobs.length) {
          if (generation !== this.generation) return;
          await jobs[next++]();
        }
      }));
      if (generation !== this.generation) return;
      documents.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
      this.index.replace(documents);
      this.changed$.next();
    } catch (error) {
      if (generation === this.generation) this.error$.next('Could not refresh text search. Try reopening search.');
      this.logger.error('Failed to build text search index', error);
    } finally {
      if (generation === this.generation) this.loading$.next(false);
    }
  }
}
