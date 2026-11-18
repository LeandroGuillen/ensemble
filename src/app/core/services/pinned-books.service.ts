import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, distinctUntilChanged, map, shareReplay } from 'rxjs';
import { Book, Project } from '../interfaces/project.interface';
import { manuscriptChapterCode, parseBookPlan, planChapterProgress } from '../utils/book-plan.utils';
import { isSameOrInsidePath, pathJoin } from '../utils/path.utils';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { ProjectService } from './project.service';

/** Chapter counts of the current book's plan; `drafted` is null without a manuscript folder. */
export interface PinnedBookProgress {
  total: number;
  drafted: number | null;
}

/** Pinned books of a project, in order, dropping ids of books that no longer exist. */
export function resolvePinnedBooks(project: Project | null | undefined): Book[] {
  const books = project?.metadata?.books ?? [];
  const seen = new Set<string>();
  const pinned: Book[] = [];
  for (const id of project?.metadata?.pinnedBookIds ?? []) {
    const book = books.find((candidate) => candidate.id === id);
    if (book && !seen.has(id)) {
      seen.add(id);
      pinned.push(book);
    }
  }
  return pinned;
}

const normalize = (path: string): string => path.replace(/\\/g, '/');

/** Drag data type for a book dragged from the Books page (value: the book id). */
export const BOOK_DRAG_TYPE = 'application/x-ensemble-book';

/**
 * Books pinned to the sidebar (`ensemble.json` → `pinnedBookIds`). The first
 * pinned book is the current one: the sidebar shows it as a card with its
 * chapter progress, read from the plan file and the manuscript folder.
 */
@Injectable({ providedIn: 'root' })
export class PinnedBooksService {
  private readonly projects = inject(ProjectService);
  private readonly electron = inject(ElectronService);
  private readonly watcher = inject(FileWatcherService);

  /** Pinned books in order; the first is the current book. */
  readonly pinned$: Observable<Book[]> = this.projects.currentProject$.pipe(
    map((project) => resolvePinnedBooks(project)),
    distinctUntilChanged((a, b) => a.length === b.length && a.every((book, i) => book === b[i])),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly draggingSubject = new BehaviorSubject<string | null>(null);
  /** Id of the book being dragged from the Books page, so the sidebar can offer itself as a drop target. */
  readonly draggingBookId$ = this.draggingSubject.asObservable();

  private readonly progressSubject = new BehaviorSubject<PinnedBookProgress | null>(null);
  /** Progress of the current book; null when it has no plan file (or none is pinned). */
  readonly progress$ = this.progressSubject.asObservable();

  /** Identity of what the progress was read from, to reload only when it changes. */
  private sourceKey = '';
  private loadToken = 0;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.projects.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      const key = this.keyFor(project);
      if (key !== this.sourceKey) {
        this.sourceKey = key;
        void this.loadProgress();
      }
    });
    this.watcher.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => this.onFileChange(event));
  }

  /**
   * Reads the current book's progress again. The manuscript folder is usually
   * outside the watched folders, so the sidebar calls this when the window
   * regains focus (a chapter written in another editor).
   */
  refresh(): void {
    if (this.sourceKey) void this.loadProgress();
  }

  startBookDrag(bookId: string): void {
    this.draggingSubject.next(bookId);
  }

  endBookDrag(): void {
    if (this.draggingSubject.value !== null) this.draggingSubject.next(null);
  }

  /** The book being dragged right now, if any. */
  get draggingBookId(): string | null {
    return this.draggingSubject.value;
  }

  isPinned(bookId: string): boolean {
    return this.ids().includes(bookId);
  }

  /** Pins a book as the current one (or moves an already pinned book to the front). */
  async pin(bookId: string): Promise<void> {
    await this.save([bookId, ...this.ids().filter((id) => id !== bookId)]);
  }

  async unpin(bookId: string): Promise<void> {
    await this.save(this.ids().filter((id) => id !== bookId));
  }

  async toggle(bookId: string): Promise<void> {
    await (this.isPinned(bookId) ? this.unpin(bookId) : this.pin(bookId));
  }

  /** Makes a pinned book the current one. No write when it already is. */
  async makeCurrent(bookId: string): Promise<void> {
    const ids = this.ids();
    if (ids[0] === bookId || !ids.includes(bookId)) return;
    await this.pin(bookId);
  }

  private ids(): string[] {
    return resolvePinnedBooks(this.projects.getCurrentProject()).map((book) => book.id);
  }

  private async save(ids: string[]): Promise<void> {
    await this.projects.updateMetadata({ pinnedBookIds: ids });
  }

  private current(project: Project | null | undefined): Book | null {
    return resolvePinnedBooks(project)[0] ?? null;
  }

  private keyFor(project: Project | null | undefined): string {
    const book = this.current(project);
    if (!project || !book) return '';
    return [project.path, book.id, book.plan?.path ?? '', book.plan?.manuscriptDir ?? ''].join('|');
  }

  private onFileChange(event: FileChangeEvent): void {
    const project = this.projects.getCurrentProject();
    const book = this.current(project);
    const planPath = book?.plan?.path?.trim();
    if (!project || !planPath) return;
    const changed = normalize(event.path);
    const dir = book?.plan?.manuscriptDir?.trim();
    const touchesPlan = changed === normalize(pathJoin(project.path, planPath));
    const touchesManuscript = !!dir && isSameOrInsidePath(pathJoin(project.path, dir), changed);
    if (!touchesPlan && !touchesManuscript) return;
    // Saving a chapter or the plan fires several events; read once they settle.
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.loadProgress();
    }, 400);
  }

  private async loadProgress(): Promise<void> {
    const token = ++this.loadToken;
    const project = this.projects.getCurrentProject();
    const book = this.current(project);
    const planPath = book?.plan?.path?.trim();
    if (!project || !planPath) {
      this.progressSubject.next(null);
      return;
    }
    let progress: PinnedBookProgress | null = null;
    try {
      const read = await this.electron.readFile(pathJoin(project.path, planPath));
      if (read.success) {
        const dir = book?.plan?.manuscriptDir?.trim();
        const drafted = dir ? await this.draftedCodes(pathJoin(project.path, dir)) : null;
        const counts = planChapterProgress(parseBookPlan(read.content ?? ''), drafted ?? new Set());
        progress = { total: counts.total, drafted: drafted ? counts.drafted : null };
      }
    } catch {
      progress = null;
    }
    if (token === this.loadToken) this.progressSubject.next(progress);
  }

  private async draftedCodes(absoluteDir: string): Promise<Set<string>> {
    const result = await this.electron.readDirectoryRecursive(absoluteDir, '*');
    const codes = new Set<string>();
    for (const file of result.files ?? []) {
      const code = manuscriptChapterCode(file.relativePath);
      if (code) codes.add(code);
    }
    return codes;
  }
}
