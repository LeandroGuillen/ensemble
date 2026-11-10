import { AfterViewInit, Component, DestroyRef, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnInit, Output, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Character } from '../../../core/interfaces/character.interface';
import { Book } from '../../../core/interfaces/project.interface';
import { CharacterService } from '../../../core/services/character.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TimelineContext, TimelineService } from '../../../core/services/timeline.service';
import { ContinuityIssue, StoryChapter, buildStoryChapters, continuityIssues } from '../../../core/utils/timeline.utils';
import {
  WorldCalendar,
  dateFromDay,
  formatDayRange,
  formatDuration,
  formatWorldSpan,
  formatYear,
  parseWorldSpan,
  shortMonthName,
  spanDays,
} from '../../../core/utils/world-date.utils';
import { PovChipComponent } from '../pov-chip.component';
import { TimelinePortraits } from '../../timeline/timeline-shared';

type Mode = 'story' | 'reading';
type LaneBy = 'pov' | 'place';
type Scope = 'book' | 'series';

interface Block { chapter: StoryChapter; x: number; y: number; w: number; conflict: boolean }
interface LaneRow { key: string; label: string; personId: string | null; y: number; height: number }
interface AxisTick { x: number; label: string; major: boolean }
interface AxisLabel { x: number; w?: number; label: string; sub?: string; back?: boolean }
interface Break { x: number; label: string }
interface PathSegment { d: string; back: boolean; label: string | null; lx: number; ly: number }

const LANE_H = 50;
const AXIS_H = 46;
const LEFT = 168;
const PAD = 24;
const BREAK_W = 76;
/** Chapters closer than this many days share a stretch of the axis; longer gaps fold. */
const GAP_DAYS = 20;
const SLOT = 136;

/**
 * Story time: a book's chapters laid out by their `When:` dates in PoV (or place) lanes,
 * animated into reading order on demand, with continuity checks.
 */
@Component({
  selector: 'app-story-time',
  imports: [FormsModule, PovChipComponent],
  templateUrl: './story-time.component.html',
  styleUrl: './story-time.component.scss',
})
export class StoryTimeComponent implements OnInit, OnChanges, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly timeline = inject(TimelineService);
  private readonly characterService = inject(CharacterService);
  private readonly notifications = inject(NotificationService);
  private readonly zone = inject(NgZone);

  @Input({ required: true }) bookId!: string;
  /** Open a book's plan at a line (the book page switches to the plan view). */
  @Output() openLine = new EventEmitter<{ bookId: string; line: number }>();

  @ViewChild('canvasWrap') canvasWrap?: ElementRef<HTMLElement>;

  ctx: TimelineContext | null = null;
  calendar: WorldCalendar | null = null;
  chapters: StoryChapter[] = [];
  issues: ContinuityIssue[] = [];
  seriesBooks: Book[] = [];

  scope: Scope = 'book';
  mode: Mode = 'story';
  laneBy: LaneBy = 'pov';
  zoom = 20;
  private autoFit = true;
  selectedKey: string | null = null;
  whenDraft = '';

  readonly left = LEFT;
  readonly axisHeight = AXIS_H;
  blocks: Block[] = [];
  lanes: LaneRow[] = [];
  ticks: AxisTick[] = [];
  clusterLabels: AxisLabel[] = [];
  readingLabels: AxisLabel[] = [];
  breaks: Break[] = [];
  path: PathSegment[] = [];
  width = 600;
  height = 200;

  private readonly portraits = new TimelinePortraits(this.characterService);
  private pathTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.timeline.ensureLoaded();
    this.timeline.context$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ctx) => {
      this.ctx = ctx;
      this.calendar = ctx.calendar;
      this.rebuild();
    });
  }

  ngOnChanges(): void {
    this.autoFit = true;
    this.selectedKey = null;
    this.rebuild();
  }

  ngAfterViewInit(): void {
    const host = this.canvasWrap?.nativeElement;
    if (!host) return;
    const observer = new ResizeObserver(() => this.zone.run(() => {
      if (this.autoFit) this.fit();
      this.layout();
    }));
    observer.observe(host);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  get book(): Book | undefined {
    return this.ctx?.books.find((b) => b.id === this.bookId);
  }

  get booksInScope(): Book[] {
    return this.scope === 'series' && this.seriesBooks.length > 1 ? this.seriesBooks : this.book ? [this.book] : [];
  }

  get selected(): StoryChapter | null {
    return this.chapters.find((c) => c.key === this.selectedKey) ?? null;
  }

  private rebuild(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bookId) return;
    const book = this.book;
    this.seriesBooks = book?.seriesId ? ctx.books.filter((b) => b.seriesId === book.seriesId && ctx.plans.has(b.id)) : [];
    this.chapters = this.booksInScope.flatMap((b) => {
      const plan = ctx.plans.get(b.id);
      return plan ? buildStoryChapters(b.id, plan, ctx.calendar, ctx.resolve) : [];
    });
    this.issues = continuityIssues(this.chapters, ctx.charactersById, ctx.calendar);
    if (!this.selected) this.selectedKey = this.chapters.find((c) => c.bookId === this.bookId)?.key ?? this.chapters[0]?.key ?? null;
    this.whenDraft = this.selected?.whenText ?? '';
    const people = new Set(this.chapters.flatMap((c) => c.people));
    void this.portraits.load(ctx.characters.filter((c) => people.has(c.id)));
    if (this.autoFit) this.fit();
    this.layout();
  }

  // ------------------------------------------------------------ controls

  setScope(scope: Scope): void {
    this.scope = scope;
    this.autoFit = true;
    this.rebuild();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.layout();
  }

  setLaneBy(laneBy: LaneBy): void {
    this.laneBy = laneBy;
    this.layout();
  }

  onZoom(): void {
    this.autoFit = false;
    this.layout();
  }

  fitToWidth(): void {
    this.autoFit = true;
    this.fit();
    this.layout();
  }

  select(chapter: StoryChapter): void {
    this.selectedKey = chapter.key;
    this.whenDraft = chapter.whenText;
    this.layout();
  }

  // ------------------------------------------------------------ layout

  private clusters(): { start: number; end: number; items: StoryChapter[] }[] {
    const dated = this.chapters.filter((c) => c.range).sort((a, b) => a.range!.start - b.range!.start);
    const clusters: { start: number; end: number; items: StoryChapter[] }[] = [];
    for (const chapter of dated) {
      const last = clusters[clusters.length - 1];
      if (last && chapter.range!.start - last.end <= GAP_DAYS) {
        last.end = Math.max(last.end, chapter.range!.end);
        last.items.push(chapter);
      } else {
        clusters.push({ start: chapter.range!.start, end: chapter.range!.end, items: [chapter] });
      }
    }
    return clusters;
  }

  /** Pick a zoom (pixels per day) that fits the dated chapters in the visible width. */
  private fit(): void {
    const clusters = this.clusters();
    if (!clusters.length) return;
    const days = clusters.reduce((sum, c) => sum + (c.end - c.start + 3), 0);
    const available = (this.canvasWrap?.nativeElement.clientWidth ?? 900) - LEFT - PAD * 2 - (clusters.length - 1) * BREAK_W - 60;
    this.zoom = Math.max(1, Math.min(60, Math.floor(available / Math.max(days, 1))));
  }

  private laneKey(chapter: StoryChapter): string {
    if (this.laneBy === 'pov') return chapter.pov[0] ?? '';
    return chapter.place ?? (chapter.placeLabel ? `label:${chapter.placeLabel.toLowerCase()}` : '');
  }

  private laneLabel(key: string, chapter: StoryChapter): string {
    if (!key) return this.laneBy === 'pov' ? 'No PoV' : 'No place';
    if (this.laneBy === 'pov') return this.ctx?.charactersById.get(key)?.name ?? key;
    return chapter.place ? this.ctx?.locationsById.get(chapter.place)?.name ?? chapter.placeLabel ?? key : chapter.placeLabel ?? key;
  }

  layout(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cal = ctx.calendar;
    const visible = this.mode === 'story' ? this.chapters.filter((c) => c.range) : this.chapters;

    const laneKeys: string[] = [];
    const laneRows: LaneRow[] = [];
    for (const chapter of visible) {
      const key = this.laneKey(chapter);
      if (laneKeys.includes(key)) continue;
      laneKeys.push(key);
      laneRows.push({ key, label: this.laneLabel(key, chapter), personId: this.laneBy === 'pov' && key ? key : null, y: 0, height: LANE_H });
    }
    this.lanes = laneRows;

    const positions = new Map<string, { x: number; w: number }>();
    this.ticks = [];
    this.clusterLabels = [];
    this.breaks = [];
    this.readingLabels = [];
    let width: number;

    if (this.mode === 'story') {
      const ppd = this.zoom;
      const clusters = this.clusters();
      let x = LEFT + PAD;
      const placed: { s0: number; x0: number; end: number }[] = [];
      clusters.forEach((cluster, i) => {
        if (i > 0) {
          this.breaks.push({ x, label: formatDuration(cluster.start - clusters[i - 1].end - 1, cal) });
          x += BREAK_W;
        }
        const s0 = cluster.start - 1;
        const e0 = cluster.end + 2;
        placed.push({ s0, x0: x, end: e0 });
        const first = dateFromDay(cluster.start, cal);
        const long = cluster.end - cluster.start > 300;
        this.clusterLabels.push({ x, label: long ? formatYear(first.year) : `${shortMonthName(cal, first.month)} ${formatYear(first.year)}` });
        const step = ppd >= 22 ? 1 : ppd >= 10 ? 2 : ppd >= 5 ? 5 : ppd >= 2 ? 10 : 0;
        for (let day = s0; day <= e0; day++) {
          const date = dateFromDay(day, cal);
          const monthStart = date.day === 1;
          const tx = x + (day - s0) * ppd;
          if (monthStart) this.ticks.push({ x: tx, label: date.month === 1 ? formatYear(date.year) : shortMonthName(cal, date.month), major: true });
          else if (step && (date.day - 1) % step === 0 && date.day < 29) this.ticks.push({ x: tx, label: ppd >= 8 ? String(date.day) : '', major: false });
        }
        x += (e0 - s0) * ppd;
      });
      // Drop tick labels that would overlap the previous one (month names can be long).
      let labelEnd = -Infinity;
      for (const tick of this.ticks) {
        if (!tick.label) continue;
        if (tick.x < labelEnd) tick.label = '';
        else labelEnd = tick.x + tick.label.length * 6.5 + 8;
      }
      width = x + PAD;
      const xOf = (day: number) => {
        const cluster = placed.find((c) => day >= c.s0 && day <= c.end) ?? placed[0];
        return cluster.x0 + (day - cluster.s0) * ppd;
      };
      for (const chapter of visible) {
        // Day ranges are inclusive. Keep the bar within its dates even when
        // its title needs more space (the full title is available on hover).
        positions.set(chapter.key, { x: xOf(chapter.range!.start), w: Math.max(1, (chapter.range!.end - chapter.range!.start + 1) * ppd - 2) });
      }
    } else {
      const latestByBook = new Map<string, number>();
      visible.forEach((chapter, i) => {
        const x = LEFT + PAD + i * SLOT;
        positions.set(chapter.key, { x, w: SLOT - 14 });
        const latest = latestByBook.get(chapter.bookId);
        const back = !!chapter.range && latest !== undefined && chapter.range.start < latest;
        if (chapter.range) latestByBook.set(chapter.bookId, Math.max(latest ?? -Infinity, chapter.range.start));
        this.readingLabels.push({
          x,
          w: SLOT - 14,
          label: `${this.scope === 'series' ? `${chapter.bookId} ` : ''}ch ${chapter.code}`,
          sub: chapter.range ? formatDayRange({ start: chapter.range.start, end: chapter.range.start }, cal) : chapter.invalid ? 'unreadable date' : 'no date',
          back,
        });
      });
      width = LEFT + PAD + visible.length * SLOT + PAD;
    }

    // Give overlapping chapters separate rows within their PoV/place lane.
    // Keep their full date widths rather than hiding one beneath another.
    const blockY = new Map<string, number>();
    let laneY = AXIS_H;
    for (const lane of laneRows) {
      const rowEnds: number[] = [];
      const inLane = visible.filter((c) => this.laneKey(c) === lane.key)
        .sort((a, b) => positions.get(a.key)!.x - positions.get(b.key)!.x);
      lane.y = laneY;
      for (const chapter of inLane) {
        const position = positions.get(chapter.key)!;
        let row = rowEnds.findIndex((end) => end + 2 <= position.x);
        if (row < 0) row = rowEnds.length;
        rowEnds[row] = position.x + position.w;
        blockY.set(chapter.key, laneY + row * LANE_H + 6);
      }
      lane.height = Math.max(1, rowEnds.length) * LANE_H;
      laneY += lane.height;
    }

    const conflicts = new Set(this.issues.flatMap((issue) => (issue.type === 'conflict' ? [issue.a.key, issue.b.key] : [])));
    this.blocks = visible.map((chapter) => ({
      chapter,
      ...positions.get(chapter.key)!,
      y: blockY.get(chapter.key)!,
      conflict: conflicts.has(chapter.key),
    }));
    this.width = Math.max(width, (this.canvasWrap?.nativeElement.clientWidth ?? 0));
    this.height = Math.max(AXIS_H + LANE_H, laneY) + 10;
    this.schedulePath();
  }

  /** The reading path is drawn after blocks finish moving. */
  private schedulePath(): void {
    this.path = [];
    if (this.pathTimer) clearTimeout(this.pathTimer);
    this.pathTimer = setTimeout(() => this.zone.run(() => this.drawPath()), 560);
  }

  private drawPath(): void {
    const cal = this.calendar;
    if (!cal) return;
    const ordered = this.chapters.map((c) => this.blocks.find((b) => b.chapter.key === c.key)).filter((b): b is Block => !!b);
    const segments: PathSegment[] = [];
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1];
      const b = ordered[i];
      if (a.chapter.bookId !== b.chapter.bookId && this.mode === 'story') continue;
      const ax = a.x + Math.min(a.w, 60) / 2;
      const bx = b.x + Math.min(b.w, 60) / 2;
      const ay = a.y + 19;
      const by = b.y + 19;
      const mx = (ax + bx) / 2;
      const back = b.x < a.x - 1;
      const days = a.chapter.range && b.chapter.range ? a.chapter.range.start - b.chapter.range.start : 0;
      segments.push({
        d: `M${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`,
        back,
        label: back && Math.abs(ax - bx) > 140 && days > 0 ? `↶ ${formatDuration(days, cal)} back` : null,
        lx: mx,
        ly: Math.min(ay, by) - 8 - (ay === by ? 6 : 0),
      });
    }
    this.path = segments;
  }

  // ------------------------------------------------------------ chapter detail

  bookName(id: string): string {
    return this.ctx?.books.find((b) => b.id === id)?.name ?? id;
  }

  bookColor(id: string): string {
    return this.ctx?.books.find((b) => b.id === id)?.color || 'var(--color-accent-primary)';
  }

  personName(id: string): string {
    return this.ctx?.charactersById.get(id)?.name ?? id;
  }

  portrait(id: string): string | null {
    return this.portraits.get(id);
  }

  chapterLabel(chapter: StoryChapter): string {
    return `${this.scope === 'series' ? `${chapter.bookId} ` : ''}ch ${chapter.code}`;
  }

  placeText(chapter: StoryChapter): string {
    if (chapter.place) return this.ctx?.locationsById.get(chapter.place)?.name ?? chapter.placeLabel ?? chapter.place;
    return chapter.placeLabel ?? '';
  }

  get whenStatus(): { text: string; bad: boolean } {
    const cal = this.calendar;
    if (!cal) return { text: '', bad: false };
    const text = this.whenDraft.trim();
    if (!text) return { text: 'Not on the story-time axis yet', bad: false };
    const span = parseWorldSpan(text, cal);
    if (!span) return { text: 'Can’t read this date', bad: true };
    const range = spanDays(span, cal);
    const days = range.end - range.start + 1;
    return { text: `${formatWorldSpan(span, cal)}${days > 1 && days < 400 ? ` · ${days} days` : ''}`, bad: false };
  }

  async commitWhen(): Promise<void> {
    const chapter = this.selected;
    if (!chapter) return;
    const value = this.whenDraft.trim();
    if (value === chapter.whenText) return;
    if (value && this.calendar && !parseWorldSpan(value, this.calendar)) {
      this.notifications.showError('Use a date like 330-03-09, or a range: 330-03-09 → 330-03-12.');
      return;
    }
    try {
      await this.timeline.setChapterWhen(chapter.bookId, chapter.line, value);
    } catch (error) {
      this.notifications.showError(error instanceof Error ? error.message : String(error));
    }
  }

  onWhenKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitWhen();
    } else if (event.key === 'Escape') {
      this.whenDraft = this.selected?.whenText ?? '';
    }
  }

  openInPlan(chapter: StoryChapter): void {
    this.openLine.emit({ bookId: chapter.bookId, line: chapter.line });
  }

  goTo(chapter: StoryChapter): void {
    this.select(chapter);
    const block = this.blocks.find((b) => b.chapter.key === chapter.key);
    const host = this.canvasWrap?.nativeElement;
    if (block && host) host.scrollTo({ left: Math.max(0, block.x - LEFT - 80), behavior: 'smooth' });
  }

  // ------------------------------------------------------------ continuity

  get conflictCount(): number {
    return this.issues.filter((i) => i.type === 'conflict').length;
  }

  get flashbackCount(): number {
    return this.issues.filter((i) => i.type === 'flashback').length;
  }

  issueKey(issue: ContinuityIssue, index: number): string {
    return `${issue.type}:${index}`;
  }

  undatedIssues(): StoryChapter[] {
    return this.issues.flatMap((i) => (i.type === 'undated' || i.type === 'invalid' ? [i.chapter] : []));
  }

  rangeText(chapter: StoryChapter): string {
    return chapter.range && this.calendar ? formatDayRange(chapter.range, this.calendar) : '';
  }

  gapText(days: number): string {
    return this.calendar ? formatDuration(days, this.calendar) : `${days} days`;
  }

  people(chapter: StoryChapter): Character[] {
    return chapter.people.map((id) => this.ctx?.charactersById.get(id)).filter((c): c is Character => !!c);
  }
}
