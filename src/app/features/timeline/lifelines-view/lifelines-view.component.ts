import { AfterViewInit, Component, DestroyRef, ElementRef, NgZone, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Character } from '../../../core/interfaces/character.interface';
import { CharacterService } from '../../../core/services/character.service';
import { TimelineContext, TimelineService } from '../../../core/services/timeline.service';
import { povColor } from '../../../core/utils/book-plan.utils';
import { eraStarts } from '../../../core/utils/chronicle-file.utils';
import { Lifeline, TimelineItem, bookSpans, buildLifelines, chronicleItem } from '../../../core/utils/timeline.utils';
import {
  WorldCalendar,
  dayToYear,
  formatYear,
  shortMonthName,
} from '../../../core/utils/world-date.utils';
import { PovChipComponent } from '../../book-plan/pov-chip.component';
import { TimelinePortraits } from '../timeline-shared';

type ColorBy = 'house' | 'place';
type GroupBy = 'house' | 'age';
type Preset = 'all' | 'living' | 'books';

interface LaneSegment { x1: number; x2: number; color: string; lost: boolean; title: string }
interface LaneReign { x: number; w: number; title: string }
interface Lane {
  id: string;
  name: string;
  y: number;
  cy: number;
  segments: LaneSegment[];
  reigns: LaneReign[];
  bornX: number | null;
  bornColor: string;
  diedX: number | null;
  openEndX: number | null;
  /** Died before the visible range. */
  diedBefore: string | null;
  dim: boolean;
}
interface GroupRow { y: number; label: string; color: string }
interface EventMark { index: number; x: number; ys: number[]; minY: number; maxY: number; title: string; dim: boolean }
interface Tick { x: number; label: string; major: boolean }
interface Band { x: number; w: number; label: string; color?: string; showLabel: boolean }
interface Pill { y: number; x: number; w: number; text: string; muted: boolean }

const LEFT = 180;
const PLACE_PALETTE = ['#e6b957', '#48a9a6', '#bd819c', '#6fa3e0', '#93c47d', '#d98b4a', '#a58bd0', '#c9b27a', '#5fb3c9', '#e07a7a'];
const RIGHT = 20;
const AXIS = 60;
const LANE = 34;
const GROUP = 26;

/**
 * Lifelines: one line per character from birth to death, grouped by House, coloured by
 * residence or House, with House reigns, chronicle events joining the people involved, and
 * book bands. Hover reads everyone's age; a pinned year lists who is alive and where.
 */
@Component({
  selector: 'app-lifelines-view',
  imports: [RouterLink, PovChipComponent],
  templateUrl: './lifelines-view.component.html',
  styleUrl: './lifelines-view.component.scss',
})
export class LifelinesViewComponent implements OnInit, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly timeline = inject(TimelineService);
  private readonly characterService = inject(CharacterService);
  private readonly zone = inject(NgZone);

  @ViewChild('chartHost') chartHost?: ElementRef<HTMLElement>;
  @ViewChild('chart') chart?: ElementRef<SVGSVGElement>;
  @ViewChild('overview') overview?: ElementRef<SVGSVGElement>;

  ctx: TimelineContext | null = null;
  calendar: WorldCalendar | null = null;
  lines: Lifeline[] = [];
  undated: Character[] = [];
  events: TimelineItem[] = [];
  books: { id: string; name: string; color: string; from: number; to: number }[] = [];
  eras: { title: string; from: number; to: number }[] = [];
  now = 0;
  full: [number, number] = [0, 1];
  range: [number, number] = [0, 1];

  colorBy: ColorBy = 'place';
  groupBy: GroupBy = 'house';
  preset: Preset | null = 'living';
  pin: number | null = null;
  hover: number | null = null;
  focusId: string | null = null;
  eventIndex: number | null = null;

  width = 900;
  height = 300;
  readonly left = LEFT;
  readonly right = RIGHT;
  readonly axis = AXIS;
  lanes: Lane[] = [];
  groupRows: GroupRow[] = [];
  marks: EventMark[] = [];
  ticks: Tick[] = [];
  eraBands: Band[] = [];
  bookBands: Band[] = [];
  undatedY = 0;
  cursor: { x: number; label: string; labelWidth: number; pinned: boolean; pills: Pill[] } | null = null;
  tooltip: { x: number; y: number; title: string; detail: string } | null = null;

  overviewWidth = 800;
  overviewLines: { x1: number; x2: number; y: number; color: string }[] = [];
  overviewEvents: number[] = [];
  overviewTicks: { x: number; label: string }[] = [];
  windowX = 0;
  windowW = 0;

  private readonly portraits = new TimelinePortraits(this.characterService);
  private initialized = false;
  private drag: { mode: 'move' | 'left' | 'right'; startYear: number; range: [number, number] } | null = null;

  ngOnInit(): void {
    void this.timeline.ensureLoaded();
    this.timeline.context$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ctx) => {
      this.ctx = ctx;
      this.calendar = ctx.calendar;
      this.prepare();
      void this.portraits.load(ctx.characters.filter((c) => this.lines.some((l) => l.id === c.id))).then((changed) => {
        if (changed) this.layout();
      });
    });
  }

  ngAfterViewInit(): void {
    const host = this.chartHost?.nativeElement;
    if (!host) return;
    const observer = new ResizeObserver(() => this.zone.run(() => this.layout()));
    observer.observe(host);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  // ------------------------------------------------------------ data

  private prepare(): void {
    const ctx = this.ctx!;
    const cal = ctx.calendar;
    this.events = (ctx.chronicle?.parsed.entries ?? [])
      .map((entry) => chronicleItem(entry, cal, ctx.resolve))
      .filter((item) => item.range && item.people.length);
    const spans = bookSpans({ books: ctx.books, plans: ctx.plans, calendar: cal });
    this.books = ctx.books
      .filter((b) => spans.has(b.id))
      .map((b) => ({ id: b.id, name: b.name, color: b.color, from: dayToYear(spans.get(b.id)!.start, cal), to: dayToYear(spans.get(b.id)!.end + 1, cal) }));

    const marks = [
      ...this.events.map((e) => dayToYear(e.range!.end + 1, cal)),
      ...this.books.map((b) => b.to),
    ];
    const provisional = buildLifelines(ctx.characters, ctx.houses, cal, 0);
    const borns = provisional.lines.map((l) => l.born!);
    const deaths = provisional.lines.map((l) => l.died ?? l.born!);
    const latest = Math.max(...marks, ...borns, ...deaths, ...provisional.lines.flatMap((l) => l.reigns.map((r) => r.from)));
    this.now = Number.isFinite(latest) ? Math.floor(latest) + 1 : 1;
    const built = buildLifelines(ctx.characters, ctx.houses, cal, this.now);
    this.lines = built.lines;
    this.undated = built.undated;
    this.assignPlaceColors();

    const earliest = Math.min(...borns, ...this.events.map((e) => dayToYear(e.range!.start, cal)), ...this.books.map((b) => b.from));
    this.full = Number.isFinite(earliest) ? [Math.floor(earliest) - 2, this.now + 1] : [this.now - 50, this.now + 1];

    const chronicle = ctx.chronicle?.parsed;
    this.eras = [];
    if (chronicle?.eras.length) {
      const starts = eraStarts(chronicle, cal).map((day) => (day === null ? null : dayToYear(day, cal)));
      chronicle.eras.forEach((era, index) => {
        const from = starts[index];
        if (from === null) return;
        const next = starts.slice(index + 1).find((s): s is number => s !== null);
        this.eras.push({ title: era.title, from, to: next ?? this.full[1] + 1000 });
      });
    }

    if (!this.initialized && this.lines.length) {
      this.initialized = true;
      this.applyPreset(this.books.length ? 'living' : 'all', false);
      this.pin = this.books[0] ? (this.books[0].from + this.books[0].to) / 2 : this.lines[0].born! + 20;
    } else if (this.preset) {
      this.applyPreset(this.preset, false);
    }
    this.layout();
  }

  presetRange(preset: Preset): [number, number] {
    if (preset === 'all') return [...this.full];
    if (preset === 'books' && this.books.length) {
      const from = Math.min(...this.books.map((b) => b.from));
      const to = Math.max(...this.books.map((b) => b.to));
      const pad = Math.max(0.5, (to - from) * 0.08);
      return [Math.max(this.full[0], from - pad), Math.min(this.full[1] + 2, to + pad)];
    }
    // Living memory: from the earliest birth among people alive at the end.
    const alive = this.lines.filter((l) => l.died === null || l.died >= this.now - 1);
    const from = alive.length ? Math.min(...alive.map((l) => l.born!)) : this.full[0];
    return [Math.floor(from) - 3, this.full[1]];
  }

  applyPreset(preset: Preset, relayout = true): void {
    this.preset = preset;
    this.range = this.presetRange(preset);
    if (relayout) this.layout();
  }

  setColorBy(value: ColorBy): void {
    this.colorBy = value;
    this.layout();
  }

  setGroupBy(value: GroupBy): void {
    this.groupBy = value;
    this.layout();
  }

  // ------------------------------------------------------------ layout

  x(year: number): number {
    const [a, b] = this.range;
    return LEFT + ((year - a) / (b - a)) * (this.width - LEFT - RIGHT);
  }

  private yearAt(x: number): number {
    const [a, b] = this.range;
    return a + ((x - LEFT) / (this.width - LEFT - RIGHT)) * (b - a);
  }

  /** Places get distinct colors from a fixed palette, in name order, so neighbours never look alike. */
  private placeColors = new Map<string, string>();

  placeColor(id: string | null): string {
    return id ? this.placeColors.get(id) ?? povColor(id) : 'var(--color-text-muted)';
  }

  private assignPlaceColors(): void {
    const ctx = this.ctx!;
    const ids = [...new Set(this.lines.flatMap((l) => l.segments.map((s) => s.place)).filter((p): p is string => !!p))]
      .sort((a, b) => (ctx.locationsById.get(a)?.name ?? a).localeCompare(ctx.locationsById.get(b)?.name ?? b));
    this.placeColors = new Map(ids.map((id, i) => [id, PLACE_PALETTE[i % PLACE_PALETTE.length]]));
  }

  houseColor(id: string | undefined): string {
    return this.ctx?.houses.find((h) => h.id === id)?.colors[0] || '#8a93a6';
  }

  layout(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const host = this.chartHost?.nativeElement;
    if (host) this.width = Math.max(520, host.clientWidth);
    const [r0, r1] = this.range;
    const focus = this.focusSet();

    // Groups
    const groups: { label: string; color: string; ids: string[] }[] = [];
    if (this.groupBy === 'house') {
      const placed = new Set<string>();
      for (const house of ctx.houses) {
        const ids = this.lines.filter((l) => l.houses[0] === house.id && !placed.has(l.id)).map((l) => l.id);
        ids.forEach((id) => placed.add(id));
        if (ids.length) groups.push({ label: house.name, color: house.colors[0] || '#8a93a6', ids });
      }
      const rest = this.lines.filter((l) => !placed.has(l.id)).map((l) => l.id);
      if (rest.length) groups.push({ label: groups.length ? 'No House' : 'Everyone', color: 'var(--color-text-muted)', ids: rest });
    } else {
      groups.push({ label: 'Oldest first', color: 'var(--color-text-muted)', ids: this.lines.map((l) => l.id) });
    }

    let y = AXIS + 6;
    this.groupRows = [];
    this.lanes = [];
    const laneY = new Map<string, number>();
    for (const group of groups) {
      this.groupRows.push({ y, label: group.label, color: group.color });
      y += GROUP;
      for (const id of group.ids) {
        const line = this.lines.find((l) => l.id === id)!;
        const cy = y + LANE / 2;
        laneY.set(id, cy);
        this.lanes.push(this.lane(line, y, cy, focus));
        y += LANE;
      }
    }
    this.undatedY = y + 6;
    this.height = y + (this.undated.length ? 34 : 12);

    // Axis
    const span = r1 - r0;
    const step = span > 400 ? 50 : span > 150 ? 20 : span > 60 ? 10 : span > 25 ? 5 : span > 6 ? 1 : 0;
    this.ticks = [];
    if (step) {
      for (let t = Math.ceil(r0 / step) * step; t <= r1; t += step) this.ticks.push({ x: this.x(t), label: formatYear(t), major: true });
    } else {
      const months = ctx.calendar.months.length;
      for (let m = Math.ceil(r0 * months); m <= r1 * months; m++) {
        const year = Math.floor(m / months);
        const month = m - year * months + 1;
        this.ticks.push({ x: this.x(m / months), label: month === 1 ? formatYear(year) : shortMonthName(ctx.calendar, month), major: month === 1 });
      }
    }
    this.ticks = this.ticks.filter((t) => t.x >= LEFT - 1 && t.x <= this.width - RIGHT + 1);

    this.eraBands = this.eras
      .map((era) => {
        const a = Math.max(this.x(era.from), LEFT);
        const b = Math.min(this.x(era.to), this.width - RIGHT);
        return { x: a, w: b - a, label: era.title, showLabel: b - a > era.title.length * 7 + 14 };
      })
      .filter((band) => band.w > 0);
    this.bookBands = this.books
      .map((book) => {
        const a = this.x(book.from);
        const w = Math.max(5, this.x(book.to) - a);
        return { x: a, w, label: book.id, color: book.color, showLabel: true };
      })
      .filter((band) => band.x + band.w > LEFT && band.x < this.width - RIGHT);

    // Events
    this.marks = [];
    this.events.forEach((event, index) => {
      const x = this.x(dayToYear((event.range!.start + event.range!.end + 1) / 2, ctx.calendar));
      if (x < LEFT || x > this.width - RIGHT) return;
      const ys = event.people.map((id) => laneY.get(id)).filter((v): v is number => v !== undefined);
      if (!ys.length) return;
      this.marks.push({ index, x, ys, minY: Math.min(...ys), maxY: Math.max(...ys), title: event.title, dim: !!focus && !event.people.includes(this.focusId!) });
    });

    this.updateCursor();
    this.layoutOverview();
  }

  private lane(line: Lifeline, y: number, cy: number, focus: Set<string> | null): Lane {
    const ctx = this.ctx!;
    const [r0, r1] = this.range;
    const end = line.died ?? this.now;
    const clip = (v: number) => Math.min(Math.max(v, r0 - (r1 - r0)), r1 + (r1 - r0));
    const houseColor = this.houseColor(line.houses[0]);
    const segments = line.segments
      .filter((s) => s.to > r0 && s.from < r1)
      .map((s) => ({
        x1: this.x(clip(s.from)),
        x2: this.x(clip(s.to)),
        color: this.colorBy === 'place' ? this.placeColor(s.place) : houseColor,
        lost: !!s.note,
        title: `${line.name} · ${s.place ? ctx.locationsById.get(s.place)?.name ?? s.place : 'Unknown place'}${s.note ? ` (${s.note})` : ''} · ${formatYear(Math.floor(s.from))}–${s.to >= this.now ? 'now' : formatYear(Math.floor(s.to))}`,
      }));
    const reigns = line.reigns
      .filter((r) => (r.to ?? this.now) > r0 && r.from < r1)
      .map((r) => ({
        x: this.x(clip(r.from)),
        w: Math.max(2, this.x(clip(Math.min(r.to ?? end, end))) - this.x(clip(r.from))),
        title: `Head of ${ctx.houses.find((h) => h.id === r.houseId)?.name ?? r.houseId}${r.label ? ` · ${r.label}` : ''}`,
      }));
    const inRange = (v: number) => v >= r0 && v <= r1;
    return {
      id: line.id,
      name: line.name,
      y,
      cy,
      segments,
      reigns,
      bornX: inRange(line.born!) ? this.x(line.born!) : null,
      bornColor: segments[0]?.color ?? houseColor,
      diedX: line.died !== null && inRange(line.died) ? this.x(line.died) : null,
      openEndX: line.died === null && inRange(this.now) ? this.x(this.now) : null,
      diedBefore: line.died !== null && line.died < r0 ? `died ${formatYear(line.diedDate!.year)}` : line.born! > r1 ? `born ${formatYear(line.bornDate!.year)}` : null,
      dim: !!focus && !focus.has(line.id),
    };
  }

  private focusSet(): Set<string> | null {
    if (!this.focusId) return null;
    const set = new Set([this.focusId]);
    for (const event of this.events) if (event.people.includes(this.focusId)) event.people.forEach((p) => set.add(p));
    return set;
  }

  // ------------------------------------------------------------ cursor & interaction

  private updateCursor(): void {
    const at = this.hover ?? this.pin;
    if (at === null || at < this.range[0] || at > this.range[1] || !this.calendar) {
      this.cursor = null;
      return;
    }
    const x = this.x(at);
    const right = x + 44 < this.width;
    const pills: Pill[] = this.lanes.map((lane) => {
      const line = this.lines.find((l) => l.id === lane.id)!;
      let text: string;
      let muted = false;
      if (at < line.born!) {
        text = `−${Math.ceil(line.born! - at)}`;
        muted = true;
      } else if (line.died !== null && at > line.died) {
        text = '†';
        muted = true;
      } else {
        text = String(Math.floor(at - line.born! + 1e-9));
      }
      const w = text.length * 7 + 10;
      return { y: lane.cy, x: right ? x + 6 : x - 6 - w, w, text, muted };
    });
    const label = this.yearLabel(at);
    this.cursor = { x, label, labelWidth: label.length * 7 + 18, pinned: this.hover === null, pills };
  }

  yearLabel(at: number): string {
    const cal = this.calendar!;
    const year = Math.floor(at + 1e-9);
    const span = this.range[1] - this.range[0];
    if (span > 12) return formatYear(year);
    const month = Math.min(cal.months.length, Math.floor((at - year) * cal.months.length) + 1);
    return `${shortMonthName(cal, month)} ${formatYear(year)}`;
  }

  private svgPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.chart!.nativeElement.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) * this.width) / rect.width, y: ((event.clientY - rect.top) * this.height) / rect.height };
  }

  onMove(event: MouseEvent): void {
    const point = this.svgPoint(event);
    const target = (event.target as Element).closest?.('[data-event]');
    if (target) {
      const item = this.events[Number(target.getAttribute('data-event'))];
      this.tooltip = { x: event.clientX + 14, y: event.clientY + 14, title: item.title, detail: `${this.itemDate(item)} · ${this.peopleNames(item)}` };
    } else {
      this.tooltip = null;
    }
    this.hover = point.x < LEFT ? null : Math.max(this.range[0], Math.min(this.range[1], this.yearAt(point.x)));
    this.updateCursor();
  }

  onLeave(): void {
    this.hover = null;
    this.tooltip = null;
    this.updateCursor();
  }

  onClick(event: MouseEvent): void {
    const point = this.svgPoint(event);
    if (point.x < LEFT) return;
    const fine = this.range[1] - this.range[0] < 12;
    const raw = this.yearAt(point.x);
    const months = this.calendar?.months.length ?? 12;
    this.pin = fine ? Math.floor(raw * months) / months : Math.floor(raw);
    this.focusId = null;
    this.eventIndex = null;
    this.layout();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const months = this.calendar?.months.length ?? 12;
    const fine = this.range[1] - this.range[0] < 12;
    const step = (event.shiftKey ? 10 : 1) * (fine ? 1 / months : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
    this.pin = Math.max(this.full[0], Math.min(this.now, (this.pin ?? this.range[0]) + step));
    this.eventIndex = null;
    this.focusId = null;
    if (this.pin < this.range[0] || this.pin > this.range[1]) {
      const w = this.range[1] - this.range[0];
      const a = Math.max(this.full[0], Math.min(this.full[1] - w, this.pin - w / 2));
      this.range = [a, a + w];
      this.preset = null;
    }
    this.layout();
  }

  toggleFocus(id: string): void {
    this.focusId = this.focusId === id ? null : id;
    this.eventIndex = null;
    this.layout();
  }

  selectEvent(index: number, event?: Event): void {
    event?.stopPropagation();
    const item = this.events[index];
    this.eventIndex = index;
    this.focusId = null;
    this.pin = dayToYear(item.range!.start, this.calendar!);
    if (this.pin < this.range[0] || this.pin > this.range[1]) {
      const w = this.range[1] - this.range[0];
      const a = Math.max(this.full[0], Math.min(this.full[1] - w, this.pin - w / 2));
      this.range = [a, a + w];
      this.preset = null;
    }
    this.layout();
  }

  clearFocus(): void {
    this.focusId = null;
    this.layout();
  }

  // ------------------------------------------------------------ overview brush

  private layoutOverview(): void {
    const host = this.overview?.nativeElement;
    if (host) this.overviewWidth = Math.max(300, host.clientWidth);
    const [f0, f1] = this.full;
    const ox = (t: number) => ((t - f0) / (f1 - f0)) * this.overviewWidth;
    const rowH = Math.min(3.6, 40 / Math.max(1, this.lines.length));
    this.overviewLines = this.lines.map((line, i) => ({ x1: ox(line.born!), x2: ox(line.died ?? this.now), y: 5 + i * rowH, color: povColor(line.id) }));
    this.overviewEvents = this.events.map((e) => ox(dayToYear(e.range!.start, this.calendar!)));
    const span = f1 - f0;
    const step = span > 400 ? 100 : span > 150 ? 50 : span > 60 ? 20 : span > 20 ? 5 : 1;
    this.overviewTicks = [];
    for (let t = Math.ceil(f0 / step) * step; t <= f1; t += step) this.overviewTicks.push({ x: ox(t), label: formatYear(t) });
    this.windowX = ox(this.range[0]);
    this.windowW = Math.max(6, ox(this.range[1]) - ox(this.range[0]));
  }

  private overviewYear(event: PointerEvent): number {
    const rect = this.overview!.nativeElement.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * this.overviewWidth) / rect.width;
    return this.full[0] + (px / this.overviewWidth) * (this.full[1] - this.full[0]);
  }

  onOverviewDown(event: PointerEvent, mode: 'move' | 'left' | 'right' | 'jump'): void {
    event.stopPropagation();
    const year = this.overviewYear(event);
    if (mode === 'jump') {
      const w = this.range[1] - this.range[0];
      const a = Math.max(this.full[0], Math.min(this.full[1] - w, year - w / 2));
      this.range = [a, a + w];
      this.preset = null;
      this.layout();
      mode = 'move';
    }
    this.drag = { mode, startYear: year, range: [...this.range] };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  onOverviewMove(event: PointerEvent): void {
    if (!this.drag) return;
    const delta = this.overviewYear(event) - this.drag.startYear;
    let [a, b] = this.drag.range;
    const minSpan = 1;
    if (this.drag.mode === 'move') {
      const w = b - a;
      a = Math.max(this.full[0], Math.min(this.full[1] - w, a + delta));
      b = a + w;
    } else if (this.drag.mode === 'left') {
      a = Math.max(this.full[0], Math.min(b - minSpan, a + delta));
    } else {
      b = Math.min(this.full[1], Math.max(a + minSpan, b + delta));
    }
    this.range = [a, b];
    this.preset = null;
    this.layout();
  }

  onOverviewUp(): void {
    this.drag = null;
  }

  get rangeLabel(): string {
    return `${this.yearLabel(this.range[0])} – ${this.yearLabel(this.range[1])}`;
  }

  // ------------------------------------------------------------ side panel

  name(id: string): string {
    return this.ctx?.charactersById.get(id)?.name ?? id;
  }

  peopleNames(item: TimelineItem): string {
    return item.people.map((id) => this.name(id)).join(', ');
  }

  portrait(id: string): string | null {
    return this.portraits.get(id);
  }

  itemDate(item: TimelineItem): string {
    const cal = this.calendar!;
    const d = item.date!.start;
    return `${d.day !== undefined && d.month !== undefined ? `${d.day} ` : ''}${d.month !== undefined ? `${shortMonthName(cal, d.month)} ` : ''}${formatYear(d.year)}`;
  }

  get pinnedYear(): number {
    return this.pin ?? this.range[0];
  }

  get eraAtPin(): string {
    const at = this.pinnedYear;
    return this.eras.find((e) => at >= e.from && at < e.to)?.title ?? '';
  }

  get selectedEvent(): TimelineItem | null {
    return this.eventIndex !== null ? this.events[this.eventIndex] ?? null : null;
  }

  get snapshot() {
    const at = this.pinnedYear;
    const ctx = this.ctx!;
    const alive = this.lines
      .filter((l) => at >= l.born! && (l.died === null || at <= l.died))
      .map((l) => {
        const segment = l.segments.find((s) => at >= s.from && at < s.to) ?? l.segments[l.segments.length - 1];
        const reign = l.reigns.find((r) => at >= r.from && at < (r.to ?? Infinity));
        return {
          id: l.id,
          name: l.name,
          age: Math.floor(at - l.born! + 1e-9),
          place: segment?.place ? ctx.locationsById.get(segment.place)?.name ?? null : null,
          note: segment?.note ?? null,
          reign: reign ? ctx.houses.find((h) => h.id === reign.houseId)?.name ?? null : null,
        };
      });
    const year = Math.floor(at + 1e-9);
    const events = this.events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => Math.floor(dayToYear(e.range!.start, ctx.calendar)) === year);
    return {
      alive,
      unborn: this.lines.filter((l) => at < l.born!).sort((a, b) => a.born! - b.born!),
      events,
      books: this.books.filter((b) => year >= Math.floor(b.from) && year <= Math.floor(b.to - 1e-6)),
    };
  }

  get focused() {
    if (!this.focusId || !this.ctx) return null;
    const line = this.lines.find((l) => l.id === this.focusId);
    if (!line) return null;
    const ctx = this.ctx;
    const events = this.events.map((e, index) => ({ e, index })).filter(({ e }) => e.people.includes(line.id));
    const met = [...(this.focusSet() ?? [])].filter((id) => id !== line.id);
    const lastBook = this.books[this.books.length - 1];
    return {
      line,
      houses: line.houses.map((id) => ctx.houses.find((h) => h.id === id)?.name ?? id).join(', '),
      events: events.map(({ e, index }) => ({ index, title: e.title, date: this.itemDate(e), age: Math.floor(dayToYear(e.range!.start, ctx.calendar) - line.born! + 1e-9), book: e.books[0] ?? '' })),
      met: met.length,
      stays: line.segments.map((s) => ({ place: s.place ? ctx.locationsById.get(s.place)?.name ?? s.place : 'Unknown', color: this.placeColor(s.place), from: formatYear(Math.floor(s.from)), to: s.to >= this.now && line.died === null ? 'now' : s.to === line.died ? formatYear(line.diedDate!.year) : formatYear(Math.floor(s.to)), note: s.note })),
      reigns: line.reigns.map((r) => ({ house: ctx.houses.find((h) => h.id === r.houseId)?.name ?? r.houseId, label: r.label, from: formatYear(Math.floor(r.from)), to: r.to === null ? 'now' : formatYear(Math.floor(r.to)) })),
      ageNote: line.died !== null
        ? `lived ${Math.floor(line.died - line.born!)} years`
        : lastBook ? `age ${Math.floor(lastBook.from - line.born!)} in ${lastBook.name}` : `age ${Math.floor(this.now - line.born!)} at the latest date`,
    };
  }

  get legend(): { label: string; color: string }[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    if (this.colorBy === 'house') return ctx.houses.filter((h) => this.lines.some((l) => l.houses[0] === h.id)).map((h) => ({ label: h.name, color: h.colors[0] || '#8a93a6' }));
    const places = new Set(this.lines.flatMap((l) => l.segments.map((s) => s.place)).filter((p): p is string => !!p));
    return [...places].map((id) => ({ label: ctx.locationsById.get(id)?.name ?? id, color: this.placeColor(id) }));
  }

  get undatedNames(): string {
    const names = this.undated.map((c) => c.name);
    return names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more` : names.join(', ');
  }
}
