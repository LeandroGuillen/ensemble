import { ChangeDetectorRef } from '@angular/core';
import { ExcerptPipe, WikiTextPipe } from '../../shared/pipes/excerpt.pipe';
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
  let writes$: Subject<string>;
  let watcher$: Subject<any>;
  let files: Map<string, string>;
  let readFile: jasmine.Spy;
  const record = (id: string, text: string) => ({ id, name: id, filePath: `/p/${id}.md`, relativePath: `${id}.md`, content: text, books: ['b'] });

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
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } },
      { provide: ProjectService, useValue: { currentProject$: project$, getCurrentProject: () => project$.value,
        getCharactersFolderPath: () => '/p/characters', getNamesFilePath: () => '/p/names.md' } },
      { provide: CharacterService, useValue: { characters$, lore$, drafts$,
        getReferenceCharacters: () => characters$, getDrafts: () => drafts$,
        getReferenceCharactersSnapshot: () => [...characters$.value, ...lore$.value], getDraftsSnapshot: () => drafts$.value,
        getBookPageFilePath: (record: any, book: string) => `/p/${record.id}.${book}.md` } },
      { provide: LocationService, useValue: { locations$: new BehaviorSubject([]), getLocations: () => new BehaviorSubject([]), loadLocations: async () => {}, getLocationsSnapshot: () =>
        [record('Harbor', 'Scar in the cliffs')] } },
      { provide: HouseService, useValue: { houses$: new BehaviorSubject([]), loadHouses: async () => {}, getSnapshot: () =>
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
    await refresh(() => { files.set('/p/Mara.b.md', 'Saved book revision'); writes$.next('/p/Mara.b.md'); });
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

  it('reads only the saved book page and keeps other cached pages searchable', async () => {
    await service.rebuild();
    readFile.calls.reset();
    const changed = firstValueFrom(service.changed$);
    files.set('/p/Mara.b.md', 'Incremental revision');
    writes$.next('/p/Mara.b.md');
    await changed;
    expect(readFile.calls.allArgs()).toEqual([['/p/Mara.b.md']]);
    expect(service.index.search('incremental revision')[0].book).toBe('Winter');
    expect(service.index.search('magical scar')[0].type).toBe('Concepts');
  });

  it('reconciles collection edits and removals without rereading book pages', async () => {
    await service.rebuild();
    readFile.calls.reset();
    const changed = firstValueFrom(service.changed$);
    characters$.next([{ ...record('Mara', 'Reconciled description'), books: [] }]);
    await changed;
    expect(readFile).not.toHaveBeenCalled();
    expect(service.index.search('reconciled description').length).toBe(1);
    expect(service.index.search('José saw')).toEqual([]);
  });

  it('replaces all sections of an externally edited file without reading unrelated sources', async () => {
    await service.rebuild();
    readFile.calls.reset();
    const changed = firstValueFrom(service.changed$);
    files.set('/p/names.md', '## New list\nUpdated sailor');
    watcher$.next({ type: 'change', path: '/p/names.md' });
    await changed;
    expect(readFile.calls.allArgs()).toEqual([['/p/names.md']]);
    expect(service.index.search('scarred sailor')).toEqual([]);
    expect(service.index.search('updated sailor').length).toBe(1);
  });

  it('normalizes watcher separators and ignores files outside the active project', async () => {
    await service.rebuild();
    readFile.calls.reset();
    const changed = firstValueFrom(service.changed$);
    files.set('/p/Mara.b.md', 'Windows watcher revision');
    watcher$.next({ type: 'change', path: '\\p\\Mara.b.md' });
    watcher$.next({ type: 'change', path: '/other/private.md' });
    watcher$.next({ type: 'change', path: '/p/.ensemble-trash/old.pinboard.md' });
    await changed;
    expect(readFile.calls.allArgs()).toEqual([['/p/Mara.b.md']]);
    expect(service.index.search('windows watcher revision').length).toBe(1);
  });

  it('keeps invalidations that arrive during an in-flight read', async () => {
    await service.rebuild();
    let release!: (result: any) => void;
    readFile.and.callFake((path: string) => path === '/p/Mara.b.md'
      ? new Promise(resolve => release = resolve)
      : Promise.resolve({ success: files.has(path), content: files.get(path) }));
    writes$.next('/p/Mara.b.md');
    const pending = service.rebuild();
    await Promise.resolve();
    writes$.next('/p/Mara.b.md');
    release({ success: true, content: 'Older revision' });
    await pending;
    readFile.and.callFake(async (path: string) => ({ success: files.has(path), content: files.get(path) }));
    files.set('/p/Mara.b.md', 'Newest revision');
    const changed = firstValueFrom(service.changed$);
    await changed;
    expect(service.index.search('newest revision').length).toBe(1);
    expect(service.index.search('older revision')).toEqual([]);
  });

  it('discovers added plot boards and removes deleted file sections incrementally', async () => {
    await service.rebuild();
    files.set('/p/new.pinboard.md', 'new board');
    let changed = firstValueFrom(service.changed$);
    watcher$.next({ type: 'add', path: '/p/new.pinboard.md' });
    await changed;
    expect(service.index.search('scar').filter(hit => hit.type === 'Plot boards').length).toBe(2);
    readFile.calls.reset();
    files.delete('/p/new.pinboard.md');
    files.delete('/p/names.md');
    changed = firstValueFrom(service.changed$);
    watcher$.next({ type: 'unlink', path: '/p/new.pinboard.md' });
    watcher$.next({ type: 'unlink', path: '/p/names.md' });
    await changed;
    expect(readFile.calls.count()).toBe(2);
    expect(service.index.search('scar').filter(hit => hit.type === 'Plot boards').length).toBe(1);
    expect(service.index.search('scarred sailor')).toEqual([]);
  });

  it('benchmarks previews and search on saves/outside edits with 2,000 characters and 4,000 book pages', async () => {
    // Disposable project fixture behind the IPC boundary: no user files or app instance.
    // Include decomposed accents, which require the more expensive highlight offset map.
    const prose = 'Jose\u0301 travelled through the northern mountains. '.repeat(60)
      + ' [[Person 1999#Heading]] [[Alias#1999]] [[Person 1|Display name]]'.repeat(4);
    const records = Array.from({ length: 2000 }, (_, i) => ({
      ...record(`Person ${i}`, `${i} ${prose}`), aliases: [`Alias#${i}`], books: ['b', 'c'],
    }));
    for (const person of records) for (const book of person.books) {
      files.set(`/p/${person.id}.${book}.md`, `${person.id} ${book} ${prose}`);
    }
    let changed = firstValueFrom(service.changed$);
    characters$.next(records);
    await changed;
    expect(service.index.search('northern mountains').length).toBe(6000);
    // The list's impure pipes run alongside indexing on each change-detection pass.
    // All subscriptions use the real shared WikiLinkTargetsService, not a stub resolver.
    const pipes = TestBed.runInInjectionContext(() => records.map(() => ({
      excerpt: new ExcerptPipe(), wiki: new WikiTextPipe(),
    })));
    const render = () => records.forEach((person, i) => {
      pipes[i].excerpt.transform(person.content);
      pipes[i].wiki.transform(person.content);
    });
    render();
    const markForCheck = spyOn(TestBed.inject(ChangeDetectorRef), 'markForCheck');
    expect(PerformanceObserver.supportedEntryTypes).toContain('longtask');
    const tasks: PerformanceEntry[] = [];
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries()));
    observer.observe({ entryTypes: ['longtask'] });
    const measurements: { edit: string; latency: number; previewTask: number; longestTask: number }[] = [];
    try {
      for (const edit of ['save', 'description', 'outside edit']) {
        readFile.calls.reset();
        changed = firstValueFrom(service.changed$);
        const start = performance.now();
        const term = `uniquely searchable ${edit}`;
        if (edit === 'description') {
          records[0] = { ...records[0], content: term };
          characters$.next([...records]);
        } else {
          files.set('/p/Person 0.b.md', term);
          if (edit === 'save') writes$.next('/p/Person 0.b.md');
          else watcher$.next({ type: 'change', path: '/p/Person 0.b.md' });
        }
        // Book saves and watcher reloads also publish a fresh character array in the app.
        if (edit !== 'description') characters$.next(records.map(person => ({ ...person })));
        render();
        const previewTask = performance.now() - start;
        expect(previewTask).withContext(`${edit} synchronous preview task`).toBeLessThan(100);
        expect(markForCheck).not.toHaveBeenCalled();
        await changed;
        expect(service.index.search(term).length).toBe(1);
        const finish = performance.now();
        expect(finish - start).withContext(`${edit} searchable latency`).toBeLessThan(500);
        expect(readFile.calls.count()).toBe(edit === 'description' ? 0 : 1);
        await new Promise(resolve => setTimeout(resolve, 30));
        tasks.push(...observer.takeRecords());
        const longestTask = Math.max(0, ...tasks.filter(task => task.startTime >= start && task.startTime < finish)
          .map(task => task.duration));
        expect(longestTask).withContext(`${edit} indexing task duration`).toBeLessThan(100);
        measurements.push({ edit, latency: finish - start, previewTask, longestTask });
      }
      console.info('Text search + previews 2000/4000 benchmark (ms)', JSON.stringify(measurements));
    } finally {
      for (const pipe of pipes) { pipe.excerpt.ngOnDestroy(); pipe.wiki.ngOnDestroy(); }
      observer.disconnect();
    }
  }, 30000);

  it('does not publish again when the project closes as indexing finishes', async () => {
    const changed = jasmine.createSpy('changed');
    const subscription = service.changed$.subscribe(changed);
    const reconcile = service.index.reconcile.bind(service.index);
    const publish = spyOn(service.index, 'reconcile').and.callFake(async (documents, current) => {
      const result = await reconcile(documents, current);
      project$.next(null);
      return result;
    });
    await service.rebuild();
    expect(service.index.search('scar')).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    publish.and.callThrough();
    files.set('/p/Mara.b.md', 'Reopened revision');
    project$.next({ path: '/p', metadata: { books: [{ id: 'b', name: 'Winter' }] } });
    await service.rebuild();
    expect(service.index.search('reopened revision').length).toBe(1);
    expect(service.index.search('José saw')).toEqual([]);
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
