import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SidebarComponent } from './sidebar.component';
import { ProjectService } from '../../core/services';
import { Book } from '../../core/interfaces/project.interface';
import { ElectronService } from '../../core/services/electron.service';
import { PinnedBookProgress, PinnedBooksService } from '../../core/services/pinned-books.service';
import { UpdateService } from '../../core/services/update.service';
import { NotificationService } from '../../core/services/notification.service';
import { CharacterEditDialogService } from '../../core/services/character-edit-dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { SkinService } from '../../core/services/skin.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';
import { KeyboardShortcutsService } from '../keyboard-shortcuts-dialog/keyboard-shortcuts.service';

describe('SidebarComponent pinned book card', () => {
  const ashes: Book = { id: 'a', name: 'Ashes of Vell', code: 'sr2', color: '#e5a855', status: 'in-progress' };
  const lantern: Book = { id: 'b', name: 'Lantern Tide', code: 'lt1', color: '#60a5fa' };

  let fixture: ComponentFixture<SidebarComponent>;
  let pinned$: BehaviorSubject<Book[]>;
  let progress$: BehaviorSubject<PinnedBookProgress | null>;
  let dragging$: BehaviorSubject<string | null>;
  let pins: {
    pinned$: unknown; progress$: unknown; draggingBookId$: unknown; draggingBookId: string | null;
    unpin: jasmine.Spy; makeCurrent: jasmine.Spy; pin: jasmine.Spy;
  };
  let navigate: jasmine.Spy;

  const el = (): HTMLElement => fixture.nativeElement;
  const render = (): void => {
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    localStorage.setItem('sidebar-collapsed', 'false');
    spyOnProperty(window, 'innerWidth', 'get').and.returnValue(1440);
    pinned$ = new BehaviorSubject<Book[]>([]);
    progress$ = new BehaviorSubject<PinnedBookProgress | null>(null);
    dragging$ = new BehaviorSubject<string | null>(null);
    pins = {
      pinned$: pinned$.asObservable(),
      progress$: progress$.asObservable(),
      draggingBookId$: dragging$.asObservable(),
      get draggingBookId() { return dragging$.value; },
      pin: jasmine.createSpy('pin').and.resolveTo(),
      unpin: jasmine.createSpy('unpin').and.resolveTo(),
      makeCurrent: jasmine.createSpy('makeCurrent').and.resolveTo(),
    };

    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        { provide: UpdateService, useValue: { updateStatus$: of({ status: 'idle' }) } },
        { provide: ProjectService, useValue: { currentProject$: of({ name: 'Test Project' }) } },
        { provide: PinnedBooksService, useValue: pins },
        { provide: ElectronService, useValue: { getVersion: () => Promise.resolve('1.0.0') } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showError']) },
        { provide: CharacterEditDialogService, useValue: jasmine.createSpyObj('CharacterEditDialogService', ['openCreateDraft']) },
        { provide: CommandPaletteService, useValue: jasmine.createSpyObj('CommandPaletteService', ['open']) },
        { provide: KeyboardShortcutsService, useValue: jasmine.createSpyObj('KeyboardShortcutsService', ['open']) },
        { provide: ThemeService, useValue: { getAvailableThemes: () => [], currentTheme$: of(null), setTheme: () => Promise.resolve() } },
        { provide: SkinService, useValue: { getAvailableSkins: () => [], currentSkin$: of({ id: 'classic', name: 'Classic' }), setSkin: () => Promise.resolve() } },
      ],
    }).compileComponents();

    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.removeItem('sidebar-collapsed'));

  it('shows no card while nothing is pinned', () => {
    expect(el().querySelector('[data-testid="sidebar-book"]')).toBeNull();
  });

  it('puts the current book between the World and Story sections', () => {
    pinned$.next([ashes, lantern]);
    progress$.next({ total: 32, drafted: 14 });
    render();

    const sections = Array.from(el().querySelectorAll('.sidebar-nav > .nav-section'));
    expect(sections[1].querySelector('.section-label')?.textContent).toBe('World');
    expect(sections[2].getAttribute('data-testid')).toBe('sidebar-book');
    expect(sections[3].querySelector('.section-label')?.textContent).toBe('Story');

    const card = sections[2];
    expect(card.querySelector('.book-name')?.textContent).toBe('Ashes of Vell');
    expect(card.querySelector('.book-meta')?.textContent).toBe('sr2 · In progress');
    expect(card.querySelector('[data-testid="sidebar-book-progress"]')?.textContent).toBe('14 of 32 drafted');
    expect(card.querySelector('.book-progress')?.getAttribute('aria-valuenow')).toBe('14');
    expect(card.querySelector('.book-chip .chip-label')?.textContent).toBe('lt1');
  });

  it('shows only the chapter count without a manuscript folder and no bar', () => {
    pinned$.next([ashes]);
    progress$.next({ total: 1, drafted: null });
    render();

    expect(el().querySelector('[data-testid="sidebar-book-progress"]')?.textContent).toBe('1 chapter');
    expect(el().querySelector('.book-progress')).toBeNull();
    expect(el().querySelector('.book-others')).toBeNull();
  });

  it('opens the plan, the story time, and switches to another pinned book', () => {
    pinned$.next([ashes, lantern]);
    render();

    const quick = el().querySelectorAll<HTMLButtonElement>('.book-quick button');
    quick[0].click();
    expect(navigate).toHaveBeenCalledWith(['/book', 'a'], {});
    quick[1].click();
    expect(navigate).toHaveBeenCalledWith(['/book', 'a'], { queryParams: { view: 'timeline' } });

    el().querySelector<HTMLButtonElement>('.book-chip')!.click();
    expect(navigate).toHaveBeenCalledWith(['/book', 'b'], {});
    expect(pins.makeCurrent).toHaveBeenCalledOnceWith('b');
  });

  it('reads the progress again when the window regains focus', () => {
    (pins as unknown as { refresh: jasmine.Spy }).refresh = jasmine.createSpy('refresh');
    window.dispatchEvent(new Event('focus'));
    expect((pins as unknown as { refresh: jasmine.Spy }).refresh).not.toHaveBeenCalled();
    pinned$.next([ashes]);
    window.dispatchEvent(new Event('focus'));
    expect((pins as unknown as { refresh: jasmine.Spy }).refresh).toHaveBeenCalledTimes(1);
  });

  it('unpins from the card', () => {
    pinned$.next([ashes]);
    render();
    el().querySelector<HTMLButtonElement>('.book-unpin')!.click();
    expect(pins.unpin).toHaveBeenCalledOnceWith('a');
  });

  it('shows the book as a tile on the collapsed rail', () => {
    pinned$.next([ashes, lantern]);
    render();
    fixture.componentInstance.toggleCollapse();
    render();

    expect(el().querySelector('.book-card')).toBeNull();
    const tile = el().querySelector<HTMLButtonElement>('.book-tile-item')!;
    expect(tile.getAttribute('aria-label')).toBe('Open book sr2 — Ashes of Vell');
    tile.click();
    expect(navigate).toHaveBeenCalledWith(['/book', 'a'], {});
  });

  describe('dragging a book from the Books page', () => {
    const dragEvent = (type: string): DragEvent => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: 'none', getData: () => '' } });
      return event;
    };
    const section = (): HTMLElement | null => el().querySelector('[data-testid="sidebar-book"]');

    it('lights up an empty pin area above Story and pins the dropped book', () => {
      expect(section()).toBeNull();

      dragging$.next('b');
      render();
      const zone = section()!;
      expect(zone.classList).toContain('drop-target');
      expect(zone.querySelector('[data-testid="sidebar-book-drop"]')?.textContent).toContain('Drop here to pin');

      const over = dragEvent('dragover');
      zone.dispatchEvent(over);
      render();
      expect(over.defaultPrevented).toBeTrue();
      expect(over.dataTransfer!.dropEffect).toBe('copy');
      expect(zone.classList).toContain('drop-hover');

      const drop = dragEvent('drop');
      zone.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBeTrue();
      expect(pins.pin).toHaveBeenCalledOnceWith('b');

      dragging$.next(null);
      render();
      expect(section()).toBeNull();
    });

    it('makes the dropped book current when one is already pinned', () => {
      pinned$.next([ashes]);
      dragging$.next('b');
      render();
      expect(section()!.querySelector('.book-card')).not.toBeNull();
      expect(section()!.querySelector('[data-testid="sidebar-book-drop"]')).toBeNull();
      section()!.dispatchEvent(dragEvent('drop'));
      expect(pins.pin).toHaveBeenCalledOnceWith('b');
    });

    it('ignores drags that are not books', () => {
      pinned$.next([ashes]);
      render();
      const over = dragEvent('dragover');
      section()!.dispatchEvent(over);
      section()!.dispatchEvent(dragEvent('drop'));
      expect(over.defaultPrevented).toBeFalse();
      expect(pins.pin).not.toHaveBeenCalled();
    });
  });
});
