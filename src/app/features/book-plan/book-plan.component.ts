import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { Book, Saga, Series } from '../../core/interfaces/project.interface';
import { Character } from '../../core/interfaces/character.interface';
import { PlanHeading, PlanMarker, PlanPov } from '../../core/interfaces/book-plan.interface';
import { BookEditActionsService, BookFormData } from '../../core/services/book-edit-actions.service';
import { BookPlanService, BookPlanState } from '../../core/services/book-plan.service';
import { CharacterPickerService } from '../../core/services/character-picker.service';
import { CharacterService } from '../../core/services/character.service';
import { ElectronService } from '../../core/services/electron.service';
import { LoggingService } from '../../core/services/logging.service';
import { MetadataService } from '../../core/services/metadata.service';
import { NotificationService } from '../../core/services/notification.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { ProjectService } from '../../core/services/project.service';
import { WikiLinkTargetsService } from '../../core/services/wiki-link-targets.service';
import { getBookDisplayName, getBookTitle } from '../../core/utils/book-display.utils';
import {
  PlanFocusTarget,
  flattenOutline,
  focusTargetAtLine,
  formatPovLine,
  headingTrail,
  planFocusTargets,
} from '../../core/utils/book-plan.utils';
import { PlanSearchCharacter } from '../../core/utils/plan-search.utils';
import { pathJoin } from '../../core/utils/path.utils';
import { ResolvedWikiLink } from '../../core/utils/wiki-links.utils';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';
import {
  FocusRange,
  MarkdownEditorComponent,
  WikiLinkSuggestion,
} from '../../shared/markdown-editor/markdown-editor.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { BookEditorComponent } from '../library-management/components/book-editor/book-editor.component';
import { PLAN_MARKER_LABELS, PlanSearchComponent } from './plan-search/plan-search.component';
import { PovChipComponent } from './pov-chip.component';
import { OverscrollDirection, OverscrollState, OverscrollTracker } from './overscroll';

/** Markers shown as badges in the outline. */
const OUTLINE_MARKERS: PlanMarker[] = ['todo', 'ojo'];
const HISTORY_LIMIT = 50;
const IDLE_OVERSCROLL: OverscrollState = { direction: 0, progress: 0, fired: false };
/** Section change animation: distance (px) and durations (ms). */
const SLIDE_DISTANCE = 64;
const SLIDE_OUT_MS = 220;
const SLIDE_IN_MS = 340;

/**
 * Book page: the book's plan (outline + focused Markdown editor). Clicking a book opens it;
 * "Edit book…" opens the Edit Book modal.
 */
@Component({
  selector: 'app-book-plan',
  imports: [
    FormsModule,
    PageHeaderComponent,
    MarkdownEditorComponent,
    BookEditorComponent,
    PlanSearchComponent,
    PovChipComponent,
  ],
  templateUrl: './book-plan.component.html',
  styleUrl: './book-plan.component.scss',
})
export class BookPlanComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bookPlan = inject(BookPlanService);
  private readonly projectService = inject(ProjectService);
  private readonly metadataService = inject(MetadataService);
  private readonly characterService = inject(CharacterService);
  private readonly characterPicker = inject(CharacterPickerService);
  private readonly electronService = inject(ElectronService);
  private readonly bookEditActions = inject(BookEditActionsService);
  private readonly notifications = inject(NotificationService);
  private readonly commandPalette = inject(CommandPaletteService);
  private readonly wikiLinkTargets = inject(WikiLinkTargetsService);
  private readonly logger = inject(LoggingService);
  private readonly preferences = inject(PreferencesService);

  @ViewChild(MarkdownEditorComponent) editor?: MarkdownEditorComponent;
  @ViewChild(MarkdownEditorComponent, { read: ElementRef }) editorHost?: ElementRef<HTMLElement>;
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;

  readonly markerLabels = PLAN_MARKER_LABELS;
  readonly outlineMarkers = OUTLINE_MARKERS;

  bookId = '';
  book: Book | null = null;
  state: BookPlanState | null = null;
  loading = true;

  /** Text bound to the editor; replaced only when the plan reloads from disk. */
  editorText = '';
  private editorRevision = -1;

  targets: PlanFocusTarget[] = [];
  current: PlanFocusTarget | null = null;
  trail: PlanHeading[] = [];
  cursorLine = 0;
  focusMode = true;
  /** Settings › Appearance › Plan outline side. */
  readonly outlineSide = this.preferences.getPlanOutlineSide();
  focusRange: FocusRange | null = null;
  /** `PoV:` lines of the focused chapter, hidden in focus mode (shown in the breadcrumb instead). */
  hiddenLines: FocusRange[] = [];

  searchOpen = false;
  searchQuery = '';
  characters: PlanSearchCharacter[] = [];
  private characterNames = new Map<string, string>();
  private charactersById = new Map<string, Character>();
  /** PoV character id → portrait (book-specific when the character has one for this book). */
  povThumbnails: ReadonlyMap<string, string> = new Map();
  private povThumbnailsKey = '';

  showEditor = false;
  savingBook = false;
  seriesList: Series[] = [];
  sagasList: Saga[] = [];

  linkResolver: (target: string) => ResolvedWikiLink | null = () => null;
  linkSuggestions: WikiLinkSuggestion[] = [];

  /** "Keep scrolling past the edge to change section" feedback. */
  overscroll: OverscrollState = IDLE_OVERSCROLL;
  private readonly overscrollTracker = new OverscrollTracker();
  private overscrollDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private transitioning = false;
  /** Where the running slide is heading; further PgUp/PgDn presses step from here. */
  private slideTarget: PlanFocusTarget | null = null;
  private slideDirection: OverscrollDirection = 1;
  private slideAtStart = true;
  private slideAnimations: Animation[] = [];

  private back: number[] = [];
  private forward: number[] = [];
  private paletteKey = '';
  /** Document position at the top of the editor, tracked while scrolling (the page is already detached on destroy). */
  private lastTopPos: number | null = null;
  /** Position to scroll back to the top together with `pendingLine` (returning to the page). */
  private pendingTopPos: number | null = null;
  /** Line to reveal once the plan is loaded (from `?line=`). */
  private pendingLine: number | null = null;

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        const id = params.get('id') ?? '';
        const line = Number(query.get('line'));
        this.pendingLine = query.has('line') && Number.isFinite(line) ? line : null;
        if (id !== this.bookId) {
          this.bookId = id;
          void this.load();
        } else {
          this.applyPendingLine();
        }
      });

    this.bookPlan.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((state) => {
      this.onState(state?.bookId === this.bookId ? state : null);
    });

    this.metadataService.metadata$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((metadata) => {
      this.seriesList = metadata?.series || [];
      this.sagasList = metadata?.sagas || [];
      this.book = (metadata?.books || []).find((b) => b.id === this.bookId) ?? this.book;
    });

    this.characterService
      .getCharacters()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((characters) => {
        this.characters = characters.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases }));
        this.characterNames = new Map(characters.map((c) => [c.id, c.name]));
        this.charactersById = new Map(characters.map((c) => [c.id, c]));
        this.povThumbnailsKey = '';
        void this.loadPovThumbnails();
      });

    this.wikiLinkTargets
      .targets$('character')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ resolve, suggestions }) => {
        this.linkResolver = resolve;
        this.linkSuggestions = suggestions;
      });
  }

  ngOnDestroy(): void {
    if (this.overscrollDrainTimer) clearTimeout(this.overscrollDrainTimer);
    this.saveViewState();
    // Pending writes are awaited by canLeave / prepareToLeave before navigation.
  }

  /**
   * Route leave guard. Dirty plans are flushed; unresolved disk conflicts use the
   * in-app modal (Keep mine / Reload from disk / Cancel) — never window.confirm.
   *
   * Window close / quit / reload are handled by the main-process lifecycle
   * (IPC prepareToLeave). Do not preventDefault on beforeunload: in Electron that
   * silently cancels close with no dialog.
   */
  canLeave(): boolean | Promise<boolean> {
    return this.bookPlan.prepareToLeave();
  }

  get bookTitle(): string {
    return this.book ? getBookTitle(this.book) : 'Book';
  }

  get saveStatus(): string {
    if (!this.state) return '';
    if (this.state.conflict !== null) return 'Not saved (changed on disk)';
    return this.state.dirty ? 'Saving…' : 'Saved';
  }

  /** Remember where we are, so following a link and coming back lands here again. */
  private saveViewState(): void {
    if (!this.bookId || !this.state) return;
    this.bookPlan.setViewState(this.bookId, {
      line: this.cursorLine,
      topPos: this.lastTopPos,
      focusMode: this.focusMode,
    });
  }

  private async load(): Promise<void> {
    const view = this.bookPlan.getViewState(this.bookId);
    if (view) {
      this.focusMode = view.focusMode;
      if (this.pendingLine === null) {
        this.pendingLine = view.line;
        this.pendingTopPos = view.topPos;
      }
    }
    this.loading = true;
    this.book = this.projectService.getBooks().find((b) => b.id === this.bookId) ?? null;
    this.back = [];
    this.forward = [];
    this.editorRevision = -1;
    try {
      const state = await this.bookPlan.open(this.bookId);
      this.onState(state);
      await this.bookPlan.refreshDrafts();
    } catch (error) {
      this.logger.error('Failed to open book plan', error);
    } finally {
      this.loading = false;
    }
  }

  private onState(state: BookPlanState | null): void {
    this.state = state;
    if (!state) {
      this.targets = [];
      this.current = null;
      this.trail = [];
      return;
    }
    if (state.revision !== this.editorRevision) {
      this.editorRevision = state.revision;
      this.editorText = state.text;
      if (this.pendingLine === null) this.pendingLine = this.cursorLine;
    }
    this.targets = planFocusTargets(state.parsed);
    this.registerPaletteCommands(state);
    void this.loadPovThumbnails();
    this.updateCursor(this.cursorLine);
    this.applyPendingLine();
  }

  private applyPendingLine(): void {
    if (this.pendingLine === null || !this.state) return;
    const line = this.pendingLine;
    this.pendingLine = null;
    if (this.route.snapshot.queryParamMap.has('line')) {
      // Clear it so asking for the same line again (e.g. from Ctrl+P) navigates again.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { line: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    const topPos = this.pendingTopPos;
    this.pendingTopPos = null;
    // Wait for the editor to exist / receive the new text.
    setTimeout(() => this.jumpToLine(line, false, topPos ?? undefined));
  }

  onTextChange(text: string): void {
    this.bookPlan.update(text);
  }

  onEditorBlur(): void {
    void this.bookPlan.flush();
  }

  /** Follow the cursor: the focused part is always the one containing it. */
  onCursorLine(line: number): void {
    this.updateCursor(line);
  }

  private updateCursor(line: number): void {
    this.cursorLine = line;
    if (!this.state) return;
    this.trail = headingTrail(this.state.parsed, line);
    const target = focusTargetAtLine(this.targets, line);
    this.current = target;
    const range = this.focusMode && target ? { from: target.from, to: target.to } : null;
    if (range?.from !== this.focusRange?.from || range?.to !== this.focusRange?.to) {
      this.focusRange = range;
    }
    this.updateHiddenLines(target);
  }

  private updateHiddenLines(target: PlanFocusTarget | null): void {
    const hidden = this.focusMode && target ? target.heading.pov.map((p) => ({ from: p.from, to: p.to })) : [];
    const key = (ranges: FocusRange[]) => ranges.map((r) => `${r.from}-${r.to}`).join(',');
    if (key(hidden) !== key(this.hiddenLines)) this.hiddenLines = hidden;
  }

  /** Pick a character for the current chapter's PoV: replaces `pov`, or adds a `PoV:` line below the heading. */
  async changePov(pov?: PlanPov): Promise<void> {
    const chapter = this.current?.heading;
    if (!chapter || chapter.kind !== 'chapter' || !this.state) return;
    const picked = await this.characterPicker.pick();
    if (!picked || !this.state || !this.editor) return;
    const line = formatPovLine(picked.id, picked.name);
    if (pov) {
      this.editor.replaceRange(pov.from, pov.to, line);
    } else {
      const lineEnd = this.state.text.indexOf('\n', chapter.from);
      const at = lineEnd === -1 ? this.state.text.length : lineEnd;
      this.editor.replaceRange(at, at, `\n${line}`);
    }
    this.editor.focus();
  }

  /** Move the cursor to a plan line (focus follows), recording it for Back/Forward. */
  jumpToLine(line: number, record = true, topPos?: number): void {
    if (!this.state) return;
    if (record && line !== this.cursorLine) {
      this.back.push(this.cursorLine);
      if (this.back.length > HISTORY_LIMIT) this.back.shift();
      this.forward = [];
    }
    const target = focusTargetAtLine(this.targets, line);
    const range = this.focusMode && target ? { from: target.from, to: target.to } : null;
    this.focusRange = range;
    this.updateHiddenLines(target);
    this.editor?.revealLine(line, range, topPos);
    this.updateCursor(line);
  }

  openHeading(heading: PlanHeading): void {
    this.jumpToLine(heading.line);
  }

  isCurrent(heading: PlanHeading): boolean {
    return this.current?.heading === heading;
  }

  isInTrail(heading: PlanHeading): boolean {
    return this.trail.includes(heading);
  }

  povName(characterId: string, fallback: string): string {
    return this.characterNames.get(characterId) ?? fallback;
  }

  povThumbnail(characterId: string): string | null {
    return this.povThumbnails.get(characterId) ?? null;
  }

  /** Load portraits for the plan's PoV characters (only when that set of characters changes). */
  private async loadPovThumbnails(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const ids = [...new Set(state.parsed.chapters.flatMap((c) => c.pov.map((p) => p.characterId)))].sort();
    const key = `${state.bookId}:${ids.join(',')}`;
    if (key === this.povThumbnailsKey) return;
    this.povThumbnailsKey = key;

    const characters = ids.map((id) => this.charactersById.get(id)).filter((c): c is Character => !!c);
    if (!characters.length) return;
    try {
      await this.characterService.loadThumbnailsForCharacters(characters, undefined, state.bookId);
    } catch (error) {
      this.logger.error('Failed to load PoV portraits', error);
    }
    if (key !== this.povThumbnailsKey) return;
    const thumbnails = new Map<string, string>();
    for (const character of characters) {
      const url = this.characterService.getCachedThumbnail(character.id, undefined, state.bookId);
      if (url) thumbnails.set(character.id, url);
    }
    this.povThumbnails = thumbnails;
  }

  isDrafted(heading: PlanHeading): boolean {
    return !!heading.code && !!this.state?.drafts[heading.code];
  }

  draftPath(heading: PlanHeading): string | null {
    return (heading.code && this.state?.drafts[heading.code]) || null;
  }

  markerCount(heading: PlanHeading, marker: PlanMarker): number {
    return heading.markers[marker] ?? 0;
  }

  toggleFocus(): void {
    this.focusMode = !this.focusMode;
    this.jumpToLine(this.cursorLine, false);
  }

  /** Next / previous `#`/`##` part (chapters, phase intros). */
  stepTarget(direction: 1 | -1): void {
    if (!this.targets.length) return;
    const index = this.current ? this.targets.indexOf(this.current) : -1;
    const next = this.targets[Math.max(0, Math.min(this.targets.length - 1, index + direction))];
    if (next && next !== this.current) this.jumpToLine(next.heading.line);
  }

  /** The section before / after the current one in focus mode. */
  neighbor(direction: OverscrollDirection): PlanFocusTarget | null {
    const index = this.current ? this.targets.indexOf(this.current) : -1;
    if (index === -1) return null;
    return this.targets[index + direction] ?? null;
  }

  onScroll(event: Event): void {
    const top = (event.target as HTMLElement).getBoundingClientRect().top;
    this.lastTopPos = this.editor?.posAtClientY(top) ?? null;
  }

  /** Pushing the wheel past the end (or start) of the focused section moves to the next (or previous) one. */
  onWheel(event: WheelEvent): void {
    const el = this.scroller?.nativeElement;
    if (!el || !this.focusMode || this.transitioning || event.ctrlKey || !event.deltaY) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
    const delta = event.deltaY * unit;
    const direction: OverscrollDirection = delta > 0 ? 1 : -1;
    if (!this.neighbor(direction)) {
      this.overscrollTracker.reset();
      this.overscroll = IDLE_OVERSCROLL;
      return;
    }
    const atEdge = direction === 1 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : el.scrollTop <= 1;
    this.overscroll = this.overscrollTracker.feed(delta, atEdge ? direction : 0, performance.now());
    if (this.overscroll.fired) {
      void this.slideTo(direction);
    } else {
      this.scheduleOverscrollDrain();
    }
  }

  private scheduleOverscrollDrain(): void {
    if (this.overscrollDrainTimer) clearTimeout(this.overscrollDrainTimer);
    if (!this.overscroll.progress) return;
    this.overscrollDrainTimer = setTimeout(() => {
      this.overscrollDrainTimer = null;
      this.overscroll = this.overscrollTracker.tick(performance.now());
      this.scheduleOverscrollDrain();
    }, 50);
  }

  /** PgUp / PgDn in focus mode: previous / next section, starting at its heading. */
  readonly pageNavigation = (direction: OverscrollDirection): boolean => {
    if (!this.focusMode || !this.state) return false;
    void this.slideTo(direction, 'start');
    return true;
  };

  /**
   * Slide the current section out, then the next / previous one in. Lands at the start of the
   * section, or at its end when going back by scrolling (so reading continues upwards).
   * Calls during a slide queue up: the running animation finishes at once and the slide goes
   * straight to the last requested section (three quick PgDn = three sections, one slide-in).
   */
  async slideTo(direction: OverscrollDirection, landAt: 'start' | 'auto' = 'auto'): Promise<void> {
    // Compare by heading line: an autosave mid-slide rebuilds the target objects.
    const from = this.slideTarget ?? this.current;
    const index = from ? this.targets.findIndex((t) => t.heading.line === from.heading.line) : -1;
    const destination = index === -1 ? null : this.targets[index + direction] ?? null;
    if (!destination) return;
    this.slideTarget = destination;
    this.slideDirection = direction;
    this.slideAtStart = direction === 1 || landAt === 'start';
    if (this.transitioning) {
      for (const animation of this.slideAnimations) animation.finish();
      return;
    }

    const host = this.editorHost?.nativeElement;
    const el = this.scroller?.nativeElement;
    if (!host || !el) return;
    this.transitioning = true;
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const play = async (keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<Animation | null> => {
      if (!animate) return null;
      const animation = host.animate(keyframes, options);
      this.slideAnimations.push(animation);
      await animation.finished.catch(() => undefined);
      this.slideAnimations = this.slideAnimations.filter((a) => a !== animation);
      return animation;
    };

    try {
      for (
        let step = 0;
        step < this.targets.length && this.slideTarget && this.state &&
        this.slideTarget.heading.line !== this.current?.heading.line;
        step++
      ) {
        const out = await play(
          [
            { transform: 'translateY(0)', opacity: 1 },
            { transform: `translateY(${-this.slideDirection * SLIDE_DISTANCE}px)`, opacity: 0 },
          ],
          { duration: SLIDE_OUT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
        );

        // Presses during the slide-out moved the destination; go straight to the latest one.
        const target = this.slideTarget;
        const direction = this.slideDirection;
        const atStart = this.slideAtStart;
        const line = atStart
          ? target.heading.line
          : this.state.text.slice(0, Math.max(target.from, target.to - 1)).split('\n').length - 1;
        this.jumpToLine(line);
        await nextFrame();
        await nextFrame();
        el.scrollTop = atStart ? 0 : el.scrollHeight;

        const slideIn = play(
          [
            { transform: `translateY(${direction * SLIDE_DISTANCE}px)`, opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          { duration: SLIDE_IN_MS, easing: 'cubic-bezier(0, 0, 0.2, 1)' }
        );
        out?.cancel();
        await slideIn;
      }
    } finally {
      this.slideTarget = null;
      this.overscrollTracker.reset();
      this.overscroll = IDLE_OVERSCROLL;
      this.transitioning = false;
    }
  }

  /** Next / previous heading of any outline level (scenes included). */
  stepHeading(direction: 1 | -1): void {
    if (!this.state) return;
    const headings = flattenOutline(this.state.parsed);
    const next =
      direction === 1
        ? headings.find((h) => h.line > this.cursorLine)
        : [...headings].reverse().find((h) => h.line < this.cursorLine);
    if (next) this.jumpToLine(next.line);
  }

  goBack(): void {
    const line = this.back.pop();
    if (line === undefined) return;
    this.forward.push(this.cursorLine);
    this.jumpToLine(line, false);
  }

  goForward(): void {
    const line = this.forward.pop();
    if (line === undefined) return;
    this.back.push(this.cursorLine);
    this.jumpToLine(line, false);
  }

  openSearch(query = ''): void {
    if (!this.state) return;
    this.searchQuery = query;
    this.searchOpen = true;
  }

  onSearchPick(line: number): void {
    this.searchOpen = false;
    this.jumpToLine(line);
  }

  onSearchDismiss(): void {
    this.searchOpen = false;
    this.editor?.focus();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.searchOpen || this.showEditor || !this.state) return;
    const mod = event.ctrlKey || event.metaKey;

    let handled = true;
    if (mod && !event.altKey && event.key.toLowerCase() === 'j') {
      this.openSearch();
    } else if (event.altKey && !mod && event.key === 'PageDown') {
      if (event.shiftKey) this.stepHeading(1);
      else this.stepTarget(1);
    } else if (event.altKey && !mod && event.key === 'PageUp') {
      if (event.shiftKey) this.stepHeading(-1);
      else this.stepTarget(-1);
    } else if (!mod && !event.altKey && !event.shiftKey && (event.key === 'PageDown' || event.key === 'PageUp')) {
      // The editor handles these itself when it has focus (see `pageNavigation`).
      if (event.defaultPrevented || !this.pageNavigation(event.key === 'PageDown' ? 1 : -1)) handled = false;
    } else if (mod && !event.altKey && event.key === '.') {
      this.toggleFocus();
    } else if (mod && event.altKey && event.key === 'ArrowLeft') {
      this.goBack();
    } else if (mod && event.altKey && event.key === 'ArrowRight') {
      this.goForward();
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  async resolveConflict(keep: 'disk' | 'mine'): Promise<void> {
    await this.bookPlan.resolveConflict(keep);
  }

  async openDraft(heading: PlanHeading, event: Event): Promise<void> {
    event.stopPropagation();
    const relative = this.draftPath(heading);
    const project = this.projectService.getCurrentProject();
    if (!relative || !project?.path) return;
    await this.electronService.openFileInEditor(pathJoin(project.path, relative));
  }

  async openLink(href: string): Promise<void> {
    // Missing targets would open a "New character" page; plan links often point at vault notes instead.
    if (!/^#\/(character|location|house)\//.test(href) || href.includes('fromLink=1')) return;
    await this.router.navigateByUrl(href.slice(1));
  }

  /** Create `<code>.plan.md` at the project root and attach it to the book. */
  async createPlanFile(): Promise<void> {
    const project = this.projectService.getCurrentProject();
    if (!this.book || !project?.path) return;
    const relative = `${this.book.code || this.book.id}.plan.md`;
    const absolute = pathJoin(project.path, relative);
    try {
      if (!(await this.electronService.fileExists(absolute))) {
        const result = await this.electronService.writeFileAtomic(
          absolute,
          `# ${getBookDisplayName(this.book)}\n\n## 0010 - First chapter\n\n`
        );
        if (!result.success) throw new Error(result.error);
      }
      await this.metadataService.updateBook(this.book.id, { plan: { ...this.book.plan, path: relative } });
      await this.bookPlan.open(this.book.id, true);
      this.notifications.showSuccess(`Plan file ${relative} attached`);
    } catch (error) {
      this.logger.error('Failed to create plan file', error);
      this.notifications.showError(`Could not create ${relative}: ${error}`);
    }
  }

  backToLibrary(): void {
    void this.router.navigate(['/library']);
  }

  // --- Edit book modal ---

  openBookEditor(): void {
    this.showEditor = true;
  }

  closeBookEditor(): void {
    this.showEditor = false;
  }

  async onBookSave(data: BookFormData): Promise<void> {
    if (!this.book) return;
    try {
      this.savingBook = true;
      await this.bookPlan.flush();
      this.book = await this.bookEditActions.save(this.book, data);
      this.showEditor = false;
      this.notifications.showSuccess('Book updated successfully');
      await this.bookPlan.open(this.book.id);
      await this.bookPlan.refreshDrafts();
    } catch (error) {
      this.logger.error('Failed to save book:', error);
      this.notifications.showError(`Failed to save book: ${error}`);
    } finally {
      this.savingBook = false;
    }
  }

  async onBookDelete(book: Book): Promise<void> {
    try {
      this.savingBook = true;
      if (!(await this.bookEditActions.confirmAndDelete(book))) return;
      this.showEditor = false;
      this.notifications.showSuccess(`Book "${getBookDisplayName(book)}" deleted successfully`);
      await this.router.navigate(['/library']);
    } catch (error) {
      this.logger.error('Failed to delete book:', error);
      this.notifications.showError(`Failed to delete book: ${error}`);
    } finally {
      this.savingBook = false;
    }
  }

  /** Chapters in the global palette (Ctrl+P), so "2185" works from anywhere. */
  private registerPaletteCommands(state: BookPlanState): void {
    const key = state.bookId + state.parsed.chapters.map((c) => `${c.line}:${c.heading}`).join('|');
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const book = this.projectService.getBooks().find((b) => b.id === state.bookId);
    const bookLabel = book ? getBookDisplayName(book) : state.bookId;
    this.commandPalette.replaceGroup(
      'Plan',
      state.parsed.chapters.map((chapter) => ({
        id: `plan-${state.bookId}-${chapter.code}-${chapter.line}`,
        label: `${chapter.code} ${chapter.title}`,
        metadata: `${bookLabel} plan`,
        icon: 'book-open',
        group: 'Plan',
        keywords: [chapter.heading, ...chapter.pov.map((p) => this.povName(p.characterId, p.name))],
        action: () => {
          void this.router.navigate(['/book', state.bookId], { queryParams: { line: chapter.line } });
        },
      }))
    );
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
