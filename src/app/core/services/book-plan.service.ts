import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { Book } from '../interfaces/project.interface';
import { ParsedBookPlan } from '../interfaces/book-plan.interface';
import { manuscriptChapterCode, parseBookPlan } from '../utils/book-plan.utils';
import { pathJoin } from '../utils/path.utils';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { ModalService } from './modal.service';
import { ProjectService } from './project.service';

/** Where the reader was in a plan, kept for the session so returning to the book page restores it. */
export interface BookPlanViewState {
  line: number;
  /** Document position shown at the top of the editor. */
  topPos: number | null;
  focusMode: boolean;
}

/** Idle time after the last edit before the plan is written to disk. */
export const BOOK_PLAN_AUTOSAVE_MS = 1000;

export interface BookPlanState {
  bookId: string;
  /** Plan file, relative to the project root. */
  relativePath: string;
  text: string;
  parsed: ParsedBookPlan;
  /** Chapter code → manuscript file (relative to the project root) for drafted chapters. */
  drafts: Record<string, string>;
  /** Edits not yet written to disk. */
  dirty: boolean;
  /** Disk content that changed while there were unsaved edits; autosave pauses until resolved. */
  conflict: string | null;
  /** Bumped whenever `text` is replaced from disk, so editors know to reset their content. */
  revision: number;
  error: string | null;
}

/**
 * Loads, autosaves and watches a book's plan file (`Book.plan.path`).
 * The file stays plain Markdown so it can be edited elsewhere (e.g. Obsidian) at the same time.
 */
@Injectable({
  providedIn: 'root',
})
export class BookPlanService {
  private stateSubject = new BehaviorSubject<BookPlanState | null>(null);
  public state$ = this.stateSubject.asObservable();

  /** Last content known to be on disk: our own writes echo back through the watcher. */
  private diskText: string | null = null;
  private projectPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private viewStates = new Map<string, BookPlanViewState>();
  /** Reused while a leave/conflict prompt is open (route leave or project switch). */
  private leavePrompt: Promise<boolean> | null = null;

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private fileWatcherService: FileWatcherService,
    private logger: LoggingService,
    private modalService: ModalService
  ) {
    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      const path = project?.path ?? null;
      if (path !== this.projectPath) {
        // Pending edits are persisted by prepareToLeave() before ProjectService switches.
        this.viewStates.clear();
        this.projectPath = path;
        this.reset();
      }
    });

    this.fileWatcherService.fileChanges$.pipe(takeUntilDestroyed()).subscribe((event) => {
      void this.handleFileChange(event);
    });
  }

  /** True when there are unsaved edits or an unresolved disk conflict. */
  hasPendingWork(): boolean {
    const state = this.stateSubject.value;
    return !!state && (state.dirty || state.conflict !== null);
  }

  /**
   * Persist or resolve pending plan edits before leaving the page or switching project.
   * Dirty (no conflict): await a write. Conflict: Keep mine / Reload from disk / Cancel.
   * Clean: no prompt. Returns false if the user cancelled.
   */
  prepareToLeave(): boolean | Promise<boolean> {
    const state = this.stateSubject.value;
    if (!state) {
      return true;
    }
    if (state.conflict !== null) {
      this.leavePrompt ??= this.promptConflictResolution().finally(() => {
        this.leavePrompt = null;
      });
      return this.leavePrompt;
    }
    if (state.dirty) {
      return this.flush().then(() => true);
    }
    return true;
  }

  private async promptConflictResolution(): Promise<boolean> {
    const choice = await this.modalService.choose(
      'This plan changed on disk while you had unsaved edits. What do you want to do with your version?',
      'Plan changed on disk',
      {
        confirmText: 'Keep mine',
        secondaryText: 'Reload from disk',
        cancelText: 'Cancel',
      }
    );
    if (choice === 'cancel') {
      return false;
    }
    await this.resolveConflict(choice === 'primary' ? 'mine' : 'disk');
    return true;
  }

  getViewState(bookId: string): BookPlanViewState | null {
    return this.viewStates.get(bookId) ?? null;
  }

  setViewState(bookId: string, view: BookPlanViewState): void {
    this.viewStates.set(bookId, view);
  }

  get snapshot(): BookPlanState | null {
    return this.stateSubject.value;
  }

  /** Books that have a plan file configured. */
  booksWithPlans(): Book[] {
    return this.projectService.getBooks().filter((book) => !!book.plan?.path?.trim());
  }

  /**
   * Load a book's plan. Pending edits of a previously open plan are saved first.
   * Returns the current state when that plan is already open, unless `force` is set.
   */
  async open(bookId: string, force = false): Promise<BookPlanState | null> {
    const current = this.stateSubject.value;
    const book = this.projectService.getBooks().find((b) => b.id === bookId);
    const relativePath = book?.plan?.path?.trim();
    if (!force && current?.bookId === bookId && current.relativePath === relativePath && !current.error) {
      return current;
    }
    await this.flush();

    const absolutePath = relativePath ? this.absolutePath(relativePath) : null;
    if (!book || !relativePath || !absolutePath) {
      this.reset();
      return null;
    }

    const result = await this.electronService.readFile(absolutePath);
    const text = result.success ? result.content ?? '' : '';
    this.diskText = result.success ? text : null;
    const state: BookPlanState = {
      bookId,
      relativePath,
      text,
      parsed: parseBookPlan(text),
      drafts: await this.scanDrafts(book),
      dirty: false,
      conflict: null,
      revision: (current?.revision ?? 0) + 1,
      error: result.success ? null : result.error || `Could not read ${relativePath}`,
    };
    this.stateSubject.next(state);
    return state;
  }

  /** Replace the plan text (from the editor) and schedule an autosave. */
  update(text: string): void {
    const state = this.stateSubject.value;
    if (!state || state.text === text) {
      return;
    }
    this.patch({ text, parsed: parseBookPlan(text), dirty: true });
    this.scheduleSave();
  }

  /** Write pending edits now (on blur, leaving the page, switching plans). */
  async flush(): Promise<void> {
    this.clearSaveTimer();
    const state = this.stateSubject.value;
    if (state?.dirty && state.conflict === null) {
      await this.save();
    }
    await this.saving;
  }

  /** Resolve an external change that arrived while there were unsaved edits. */
  async resolveConflict(keep: 'disk' | 'mine'): Promise<void> {
    const state = this.stateSubject.value;
    if (!state || state.conflict === null) {
      return;
    }
    if (keep === 'disk') {
      this.diskText = state.conflict;
      this.patch({
        text: state.conflict,
        parsed: parseBookPlan(state.conflict),
        dirty: false,
        conflict: null,
        revision: state.revision + 1,
      });
      return;
    }
    this.patch({ conflict: null });
    await this.save();
  }

  /** Re-scan the manuscript folder for drafted chapters. */
  async refreshDrafts(): Promise<void> {
    const state = this.stateSubject.value;
    const book = state && this.projectService.getBooks().find((b) => b.id === state.bookId);
    if (!book) {
      return;
    }
    const drafts = await this.scanDrafts(book);
    if (this.stateSubject.value?.bookId === book.id) {
      this.patch({ drafts });
    }
  }

  private scheduleSave(): void {
    this.clearSaveTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, BOOK_PLAN_AUTOSAVE_MS);
  }

  private clearSaveTimer(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /** Saves are chained so two writes of the same file never overlap. */
  private save(): Promise<void> {
    this.saving = this.saving
      .then(() => this.writeCurrent())
      .catch((error) => this.logger.error('Failed to save book plan', error));
    return this.saving;
  }

  private async writeCurrent(): Promise<void> {
    const state = this.stateSubject.value;
    if (!state?.dirty || state.conflict !== null) {
      return;
    }
    const absolutePath = this.absolutePath(state.relativePath);
    if (!absolutePath) {
      return;
    }

    const text = state.text;
    const result = await this.electronService.writeFileAtomic(absolutePath, text);
    const latest = this.stateSubject.value;
    if (latest?.bookId !== state.bookId) {
      return;
    }
    if (!result.success) {
      this.logger.error('Failed to save book plan', result.error);
      this.patch({ error: result.error || `Could not save ${state.relativePath}` });
      return;
    }
    this.diskText = text;
    this.patch({ dirty: latest.text !== text, error: null });
  }

  private async handleFileChange(event: FileChangeEvent): Promise<void> {
    const state = this.stateSubject.value;
    const absolutePath = state && this.absolutePath(state.relativePath);
    if (!state || !absolutePath || normalizePath(event.path) !== absolutePath) {
      return;
    }

    if (event.type === 'unlink') {
      this.diskText = null;
      this.patch({ error: `${state.relativePath} was removed from disk` });
      return;
    }

    const result = await this.electronService.readFile(absolutePath);
    const latest = this.stateSubject.value;
    if (!result.success || latest?.bookId !== state.bookId) {
      return;
    }
    const content = result.content ?? '';
    if (content === latest.text) {
      this.diskText = content;
      this.patch({ dirty: false, conflict: null, error: null });
      return;
    }
    if (content === this.diskText) {
      return;
    }

    this.diskText = content;
    if (latest.dirty) {
      this.clearSaveTimer();
      this.patch({ conflict: content });
      return;
    }
    this.patch({
      text: content,
      parsed: parseBookPlan(content),
      conflict: null,
      revision: latest.revision + 1,
      error: null,
    });
  }

  private async scanDrafts(book: Book): Promise<Record<string, string>> {
    const dir = book.plan?.manuscriptDir?.trim();
    const absoluteDir = dir ? this.absolutePath(dir) : null;
    if (!dir || !absoluteDir) {
      return {};
    }
    const result = await this.electronService.readDirectoryRecursive(absoluteDir, '*');
    const drafts: Record<string, string> = {};
    for (const file of result.files ?? []) {
      const code = manuscriptChapterCode(file.relativePath);
      if (code && !drafts[code]) {
        drafts[code] = pathJoin(dir, normalizePath(file.relativePath));
      }
    }
    return drafts;
  }

  private absolutePath(relativePath: string): string | null {
    return this.projectPath ? pathJoin(this.projectPath, normalizePath(relativePath)) : null;
  }

  private patch(changes: Partial<BookPlanState>): void {
    const state = this.stateSubject.value;
    if (state) {
      this.stateSubject.next({ ...state, ...changes });
    }
  }

  private reset(): void {
    this.clearSaveTimer();
    this.diskText = null;
    if (this.stateSubject.value) {
      this.stateSubject.next(null);
    }
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}
