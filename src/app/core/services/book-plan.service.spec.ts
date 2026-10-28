import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { BOOK_PLAN_AUTOSAVE_MS, BookPlanService } from './book-plan.service';
import { ElectronService } from './electron.service';
import { FileChangeEvent, FileWatcherService } from './file-watcher.service';
import { LoggingService } from './logging.service';
import { ModalService } from './modal.service';
import { ProjectService } from './project.service';
import { Book } from '../interfaces/project.interface';

const PROJECT = '/vault';
const PLAN_PATH = `${PROJECT}/libros/b2/b2.plan.md`;
const ORIGINAL = '# Fase 1\n## 2010 - Llegando (T)\nPoV: terom Terom\n- algo\n';

describe('BookPlanService', () => {
  let service: BookPlanService;
  let electron: jasmine.SpyObj<ElectronService>;
  let fileChanges: Subject<FileChangeEvent>;
  let project$: BehaviorSubject<any>;
  let modal: jasmine.SpyObj<ModalService>;
  let disk: string;

  const books: Book[] = [
    {
      id: 'n26',
      name: 'Nueva Alascar',
      color: '#000',
      code: 'n26',
      plan: { path: 'libros/b2/b2.plan.md', manuscriptDir: 'libros/b2/n26/content' },
    },
    { id: 'n27', name: 'Untitled', color: '#000' },
  ];

  const changed = (): void => fileChanges.next({ type: 'change', path: PLAN_PATH, filename: 'b2.plan.md' });

  beforeEach(() => {
    disk = ORIGINAL;
    fileChanges = new Subject<FileChangeEvent>();
    electron = jasmine.createSpyObj('ElectronService', ['readFile', 'writeFileAtomic', 'readDirectoryRecursive']);
    electron.readFile.and.callFake(async () => ({ success: true, content: disk }));
    electron.writeFileAtomic.and.callFake(async (_path: string, content: string) => {
      disk = content;
      return { success: true };
    });
    electron.readDirectoryRecursive.and.resolveTo({
      success: true,
      files: [
        { relativePath: '2010-llegando.typ', absolutePath: '' },
        { relativePath: 'master.typ', absolutePath: '' },
      ],
    });

    const project = { path: PROJECT, metadata: { books } };
    project$ = new BehaviorSubject<any>(project);
    const projectService = {
      currentProject$: project$,
      getBooks: () => books,
    };
    modal = jasmine.createSpyObj('ModalService', ['confirm', 'choose']);
    modal.choose.and.resolveTo('primary');

    TestBed.configureTestingModule({
      providers: [
        BookPlanService,
        { provide: ElectronService, useValue: electron },
        { provide: ProjectService, useValue: projectService },
        { provide: FileWatcherService, useValue: { fileChanges$: fileChanges.asObservable() } },
        { provide: LoggingService, useValue: jasmine.createSpyObj('LoggingService', ['error']) },
        { provide: ModalService, useValue: modal },
      ],
    });
    service = TestBed.inject(BookPlanService);
  });

  it('lists only books with a plan file', () => {
    expect(service.booksWithPlans().map((b) => b.id)).toEqual(['n26']);
  });

  it('opens a plan, parses it and finds drafted chapters', async () => {
    const state = await service.open('n26');
    expect(electron.readFile).toHaveBeenCalledWith(PLAN_PATH);
    expect(state?.parsed.chapters.map((c) => c.code)).toEqual(['2010']);
    expect(state?.drafts).toEqual({ '2010': 'libros/b2/n26/content/2010-llegando.typ' });
    expect(state?.dirty).toBeFalse();
  });

  it('returns null for books without a plan', async () => {
    expect(await service.open('n27')).toBeNull();
    expect(service.snapshot).toBeNull();
  });

  it('autosaves after the idle delay', fakeAsync(() => {
    void service.open('n26');
    flushMicrotasks();

    service.update(ORIGINAL + '- uno\n');
    service.update(ORIGINAL + '- uno\n- dos\n');
    expect(service.snapshot?.dirty).toBeTrue();
    tick(BOOK_PLAN_AUTOSAVE_MS - 1);
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
    tick(1);
    flushMicrotasks();

    expect(electron.writeFileAtomic).toHaveBeenCalledOnceWith(PLAN_PATH, ORIGINAL + '- uno\n- dos\n');
    expect(service.snapshot?.dirty).toBeFalse();
  }));

  it('flush writes immediately', async () => {
    await service.open('n26');
    service.update('# Cambiado\n');
    await service.flush();
    expect(disk).toBe('# Cambiado\n');
    expect(service.snapshot?.dirty).toBeFalse();
  });

  it('ignores the watcher echo of its own write', async () => {
    await service.open('n26');
    service.update('# Mío\n');
    await service.flush();
    const revision = service.snapshot!.revision;

    changed();
    await new Promise((resolve) => setTimeout(resolve));
    expect(service.snapshot?.revision).toBe(revision);
    expect(service.snapshot?.text).toBe('# Mío\n');
  });

  it('reloads external edits when there are no unsaved changes', async () => {
    await service.open('n26');
    const revision = service.snapshot!.revision;

    disk = '# Desde Obsidian\n';
    changed();
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.snapshot?.text).toBe('# Desde Obsidian\n');
    expect(service.snapshot?.parsed.outline[0].title).toBe('Desde Obsidian');
    expect(service.snapshot?.revision).toBe(revision + 1);
  });

  it('holds external edits as a conflict while there are unsaved changes', fakeAsync(() => {
    void service.open('n26');
    flushMicrotasks();
    service.update('# Mío\n');

    disk = '# Desde Obsidian\n';
    changed();
    flushMicrotasks();
    expect(service.snapshot?.conflict).toBe('# Desde Obsidian\n');
    expect(service.snapshot?.text).toBe('# Mío\n');

    tick(BOOK_PLAN_AUTOSAVE_MS * 2);
    flushMicrotasks();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();

    void service.resolveConflict('mine');
    flushMicrotasks();
    expect(disk).toBe('# Mío\n');
    expect(service.snapshot?.conflict).toBeNull();
    expect(service.snapshot?.dirty).toBeFalse();
  }));

  it('can take the disk version of a conflict', fakeAsync(() => {
    void service.open('n26');
    flushMicrotasks();
    service.update('# Mío\n');
    disk = '# Desde Obsidian\n';
    changed();
    flushMicrotasks();

    void service.resolveConflict('disk');
    flushMicrotasks();
    tick(BOOK_PLAN_AUTOSAVE_MS);
    expect(service.snapshot?.text).toBe('# Desde Obsidian\n');
    expect(service.snapshot?.dirty).toBeFalse();
    expect(electron.writeFileAtomic).not.toHaveBeenCalled();
  }));

  it('keeps edits dirty and reports an error when saving fails', async () => {
    electron.writeFileAtomic.and.resolveTo({ success: false, error: 'disk full' });
    await service.open('n26');
    service.update('# Mío\n');
    await service.flush();
    expect(service.snapshot?.dirty).toBeTrue();
    expect(service.snapshot?.error).toBe('disk full');
  });

  describe('prepareToLeave / project switch', () => {
    it('writes a dirty plan when preparing to leave (project switch)', async () => {
      await service.open('n26');
      service.update('# Pending\n');
      expect(service.snapshot?.dirty).toBeTrue();

      const allowed = await service.prepareToLeave();

      expect(allowed).toBeTrue();
      expect(disk).toBe('# Pending\n');
      expect(service.snapshot?.dirty).toBeFalse();
      expect(modal.choose).not.toHaveBeenCalled();
    });

    it('does not silently drop a conflict when preparing to leave', async () => {
      await service.open('n26');
      service.update('# Mío\n');
      disk = '# Desde Obsidian\n';
      changed();
      await new Promise((resolve) => setTimeout(resolve));
      expect(service.snapshot?.conflict).toBe('# Desde Obsidian\n');

      modal.choose.and.resolveTo('cancel');
      const allowed = await service.prepareToLeave();

      expect(allowed).toBeFalse();
      expect(service.snapshot?.conflict).toBe('# Desde Obsidian\n');
      expect(service.snapshot?.text).toBe('# Mío\n');
      expect(electron.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('Keep mine writes the user text and clears the conflict', async () => {
      await service.open('n26');
      service.update('# Mío\n');
      disk = '# Desde Obsidian\n';
      changed();
      await new Promise((resolve) => setTimeout(resolve));

      modal.choose.and.resolveTo('primary');
      expect(await service.prepareToLeave()).toBeTrue();

      expect(disk).toBe('# Mío\n');
      expect(service.snapshot?.conflict).toBeNull();
      expect(service.snapshot?.dirty).toBeFalse();
      expect(modal.choose).toHaveBeenCalled();
    });

    it('Reload from disk loads disk text and clears the conflict', async () => {
      await service.open('n26');
      service.update('# Mío\n');
      disk = '# Desde Obsidian\n';
      changed();
      await new Promise((resolve) => setTimeout(resolve));

      modal.choose.and.resolveTo('secondary');
      expect(await service.prepareToLeave()).toBeTrue();

      expect(service.snapshot?.text).toBe('# Desde Obsidian\n');
      expect(service.snapshot?.conflict).toBeNull();
      expect(service.snapshot?.dirty).toBeFalse();
      expect(electron.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('allows leave with nothing dirty and no conflict without prompting', async () => {
      await service.open('n26');
      expect(await service.prepareToLeave()).toBeTrue();
      expect(modal.choose).not.toHaveBeenCalled();
      expect(electron.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('hasPendingWork is true for dirty or conflict, false when clean', async () => {
      await service.open('n26');
      expect(service.hasPendingWork()).toBeFalse();
      service.update('# x\n');
      expect(service.hasPendingWork()).toBeTrue();
      await service.flush();
      expect(service.hasPendingWork()).toBeFalse();

      service.update('# y\n');
      disk = '# z\n';
      changed();
      await new Promise((resolve) => setTimeout(resolve));
      expect(service.hasPendingWork()).toBeTrue();
    });
  });
});
