import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { TextSearchService } from './text-search.service';
import { CharacterService } from './character.service';
import { LocationService } from './location.service';
import { HouseService } from './house.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { FileWatcherService } from './file-watcher.service';
import { PlotBoardService } from './plot-board.service';
import { LoggingService } from './logging.service';

describe('TextSearchService', () => {
  let service: TextSearchService;
  let project$: BehaviorSubject<any>;
  let characters$: BehaviorSubject<any[]>;
  let lore$: BehaviorSubject<any[]>;
  let drafts$: BehaviorSubject<any[]>;
  let writes$: Subject<void>;
  let watcher$: Subject<any>;
  let files: Map<string, string>;
  let readFile: jasmine.Spy;
  const record = (id: string, text: string) => ({ id, name: id, filePath: `/p/${id}.md`, content: text, books: ['b'] });

  beforeEach(() => {
    project$ = new BehaviorSubject<any>({ path: '/p', metadata: { books: [{ id: 'b', name: 'Winter' }] } });
    characters$ = new BehaviorSubject<any[]>([record('Mara', 'Scar on her left hand')]);
    lore$ = new BehaviorSubject<any[]>([{ ...record('Ancestor', 'Ancient scar'), lore: true }]);
    drafts$ = new BehaviorSubject<any[]>([{ ...record('Draft', 'Unfinished scar'), draft: true }]);
    writes$ = new Subject();
    watcher$ = new Subject();
    files = new Map([
      ['/p/Mara.b.md', 'José saw the scar'],
      ['/p/characters/concepts.md', '# Secret\nA magical scar'],
      ['/p/names.md', '## Sailors\n- José\n  - scarred sailor'],
      ['/p/board.pinboard.md', 'board'],
    ]);
    readFile = jasmine.createSpy('readFile').and.callFake(async (path: string) =>
      ({ success: files.has(path), content: files.get(path) }));
    TestBed.configureTestingModule({ providers: [
      TextSearchService,
      { provide: ProjectService, useValue: { currentProject$: project$, getCurrentProject: () => project$.value,
        getCharactersFolderPath: () => '/p/characters', getNamesFilePath: () => '/p/names.md' } },
      { provide: CharacterService, useValue: { characters$, lore$, drafts$,
        getReferenceCharactersSnapshot: () => [...characters$.value, ...lore$.value], getDraftsSnapshot: () => drafts$.value,
        getBookPageFilePath: (record: any, book: string) => `/p/${record.id}.${book}.md` } },
      { provide: LocationService, useValue: { locations$: new BehaviorSubject([]), getLocationsSnapshot: () =>
        [record('Harbor', 'Scar in the cliffs')] } },
      { provide: HouseService, useValue: { houses$: new BehaviorSubject([]), getSnapshot: () =>
        [{ ...record('House', 'History of the scar'), motto: 'Endure', leadership: [] }] } },
      { provide: ElectronService, useValue: { readFile, filesWritten$: writes$ } },
      { provide: FileWatcherService, useValue: { fileChanges$: watcher$ } },
      { provide: PlotBoardService, useValue: { discoverPlotboardFiles: async () => ['board.pinboard.md', '.ensemble-trash/old.pinboard.md'],
        parseFile: () => ({ threads: [{ id: 't', name: 'Mystery' }], cells: { Scene: { t: 'Reveal the scar' } } }) } },
      { provide: LoggingService, useValue: { error: jasmine.createSpy('error') } },
    ] });
    service = TestBed.inject(TextSearchService);
  });

  it('indexes every requested type, book pages and plot cells, excluding staged trash', async () => {
    await service.rebuild();
    const results = service.index.search('scar');
    expect(new Set(results.map(result => result.type)).size).toBe(8);
    const book = results.find(result => result.book);
    expect(book?.book).toBe('Winter');
    expect(book?.queryParams).toEqual({ book: 'b' });
    expect(results.find(result => result.type === 'Plot boards')?.route).toEqual(['/plot-board', 'board.pinboard.md']);
    expect(readFile).not.toHaveBeenCalledWith('/p/.ensemble-trash/old.pinboard.md');
    const reads = readFile.calls.count();
    service.index.search('jose');
    expect(readFile.calls.count()).toBe(reads);
  });

  it('refreshes saved descriptions, book notes, external edits and removed pages', async () => {
    await service.rebuild();
    const refresh = async (action: () => void) => {
      const changed = firstValueFrom(service.changed$);
      action();
      await changed;
    };
    expect(service.index.search('scar').length).toBeGreaterThan(0);
    await refresh(() => characters$.next([record('Mara', 'New description')]));
    expect(service.index.search('new description').length).toBe(1);
    await refresh(() => { files.set('/p/Mara.b.md', 'Saved book revision'); writes$.next(); });
    expect(service.index.search('saved book revision')[0].book).toBe('Winter');
    await refresh(() => {
      files.set('/p/names.md', '## External\nNewly edited names');
      watcher$.next({ type: 'change', path: '/p/names.md' });
    });
    expect(service.index.search('newly edited names')[0].type).toBe('Name lists');
    await refresh(() => {
      files.delete('/p/Mara.b.md'); watcher$.next({ type: 'unlink', path: '/p/Mara.b.md' });
    });
    expect(service.index.search('saved book revision')).toEqual([]);
  });

  it('clears results immediately on project close and discards in-flight reads', async () => {
    let resolve!: (value: any) => void;
    readFile.and.callFake((path: string) => path === '/p/Mara.b.md'
      ? new Promise(r => resolve = r)
      : Promise.resolve({ success: files.has(path), content: files.get(path) }));
    const pending = service.rebuild();
    await Promise.resolve();
    expect(resolve).toBeDefined();
    project$.next(null);
    expect(service.index.search('scar')).toEqual([]);
    resolve({ success: true, content: 'Late scar' });
    await pending;
    expect(service.index.search('scar')).toEqual([]);
    expect(service.loading$.value).toBeFalse();
  });
});
