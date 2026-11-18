import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { Book, Project } from '../interfaces/project.interface';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { PinnedBooksService, resolvePinnedBooks } from './pinned-books.service';
import { ProjectService } from './project.service';

describe('PinnedBooksService', () => {
  const books: Book[] = [
    { id: 'a', name: 'Ashes', code: 'sr2', color: '#111', plan: { path: 'plans/ashes.md', manuscriptDir: 'ms' } },
    { id: 'b', name: 'Lantern', color: '#222' },
    { id: 'c', name: 'Crown', color: '#333', plan: { path: 'plans/crown.md' } },
  ];
  const plan = ['# Part', '## 1010 - One', '## 1020 - Two', '### 1. Scene', '## 1030 - Three'].join('\n');

  let project$: BehaviorSubject<Project | null>;
  let changes$: Subject<FileChangeEvent>;
  let electron: { readFile: jasmine.Spy; readDirectoryRecursive: jasmine.Spy };
  let service: PinnedBooksService;

  const project = (pinnedBookIds?: string[]): Project =>
    ({ path: '/p', name: 'P', metadata: { books, pinnedBookIds } }) as unknown as Project;
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    project$ = new BehaviorSubject<Project | null>(project());
    changes$ = new Subject<FileChangeEvent>();
    electron = {
      readFile: jasmine.createSpy('readFile').and.resolveTo({ success: true, content: plan }),
      readDirectoryRecursive: jasmine.createSpy('readDirectoryRecursive').and.resolveTo({
        success: true,
        files: [{ relativePath: '1010-one.typ' }, { relativePath: 'sub/1030_three.typ' }, { relativePath: 'notes.txt' }],
      }),
    };
    const projects = {
      currentProject$: project$.asObservable(),
      getCurrentProject: () => project$.value,
      updateMetadata: jasmine.createSpy('updateMetadata').and.callFake(async (updates: { pinnedBookIds: string[] }) => {
        project$.next(project(updates.pinnedBookIds));
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: projects },
        { provide: ElectronService, useValue: electron },
        { provide: FileWatcherService, useValue: { fileChanges$: changes$.asObservable() } },
      ],
    });
    service = TestBed.inject(PinnedBooksService);
  });

  it('resolves pins in order and drops missing or repeated ids', () => {
    expect(resolvePinnedBooks(project(['c', 'gone', 'a', 'c'])).map((b) => b.id)).toEqual(['c', 'a']);
    expect(resolvePinnedBooks(null)).toEqual([]);
  });

  it('pins a book as the current one and keeps the others after it', async () => {
    await service.pin('b');
    await service.pin('a');
    expect((await firstValueFrom(service.pinned$)).map((b) => b.id)).toEqual(['a', 'b']);
    expect(service.isPinned('b')).toBeTrue();

    await service.makeCurrent('b');
    expect((await firstValueFrom(service.pinned$)).map((b) => b.id)).toEqual(['b', 'a']);

    await service.toggle('b');
    expect((await firstValueFrom(service.pinned$)).map((b) => b.id)).toEqual(['a']);
  });

  it('does not write when the book is already current or is not pinned', async () => {
    await service.pin('a');
    const projects = TestBed.inject(ProjectService) as unknown as { updateMetadata: jasmine.Spy };
    projects.updateMetadata.calls.reset();
    await service.makeCurrent('a');
    await service.makeCurrent('c');
    expect(projects.updateMetadata).not.toHaveBeenCalled();
  });

  it('counts planned chapters and the ones with a manuscript file', async () => {
    await service.pin('a');
    await settle();
    expect(electron.readFile).toHaveBeenCalledWith('/p/plans/ashes.md');
    expect(electron.readDirectoryRecursive).toHaveBeenCalledWith('/p/ms', '*');
    expect(await firstValueFrom(service.progress$)).toEqual({ total: 3, drafted: 2 });
  });

  it('reports only the chapter count without a manuscript folder, and nothing without a plan', async () => {
    await service.pin('c');
    await settle();
    expect(await firstValueFrom(service.progress$)).toEqual({ total: 3, drafted: null });

    await service.pin('b');
    await settle();
    expect(await firstValueFrom(service.progress$)).toBeNull();
  });

  it('refresh() reads the current book again, and does nothing while none is pinned', async () => {
    service.refresh();
    await settle();
    expect(electron.readFile).not.toHaveBeenCalled();

    await service.pin('a');
    await settle();
    electron.readDirectoryRecursive.and.resolveTo({ success: true, files: [{ relativePath: '1010-one.typ' }] });
    service.refresh();
    await settle();
    expect(await firstValueFrom(service.progress$)).toEqual({ total: 3, drafted: 1 });
  });

  it('reads the progress again when the plan or a manuscript file changes on disk', async () => {
    jasmine.clock().install();
    try {
      await service.pin('a');
      await settle();
      electron.readFile.calls.reset();

      changes$.next({ type: 'change', path: '/p/characters/x/x.md', filename: 'x.md' });
      jasmine.clock().tick(500);
      expect(electron.readFile).not.toHaveBeenCalled();

      changes$.next({ type: 'add', path: '/p/ms/1020-two.typ', filename: '1020-two.typ' });
      changes$.next({ type: 'change', path: '/p/plans/ashes.md', filename: 'ashes.md' });
      jasmine.clock().tick(500);
      expect(electron.readFile).toHaveBeenCalledTimes(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('tracks the book being dragged from the Books page', async () => {
    expect(service.draggingBookId).toBeNull();
    service.startBookDrag('b');
    expect(await firstValueFrom(service.draggingBookId$)).toBe('b');
    service.endBookDrag();
    expect(service.draggingBookId).toBeNull();
  });
});
