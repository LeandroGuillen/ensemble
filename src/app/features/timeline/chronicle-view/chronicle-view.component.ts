import { Component, DestroyRef, ElementRef, HostListener, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Character } from '../../../core/interfaces/character.interface';
import { ElectronService } from '../../../core/services/electron.service';
import { CharacterService } from '../../../core/services/character.service';
import { LoggingService } from '../../../core/services/logging.service';
import { ModalService } from '../../../core/services/modal.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ProjectService } from '../../../core/services/project.service';
import { TimelineContext, TimelineService } from '../../../core/services/timeline.service';
import { ChronicleEntryDraft, ChronicleKind, formatChronicleEntry } from '../../../core/utils/chronicle-file.utils';
import { pathJoin } from '../../../core/utils/path.utils';
import { TimelineItem, buildTimelineItems } from '../../../core/utils/timeline.utils';
import {
  WorldSpan,
  ageAt,
  dateToYear,
  daysInYear,
  formatWorldSpan,
  formatYear,
  parseWorldSpan,
  serializeWorldSpan,
  shortMonthName,
} from '../../../core/utils/world-date.utils';
import { PovChipComponent } from '../../book-plan/pov-chip.component';
import { KIND_LABELS, TimelinePortraits } from '../timeline-shared';

type KindFilter = 'all' | 'event' | 'life' | 'reign' | 'book' | 'legend';

interface EraGroup {
  index: number;
  title: string;
  description: string;
  range: string;
  items: TimelineItem[];
}

type StreamRow =
  | { type: 'era'; group: EraGroup }
  | { type: 'gap'; years: number; key: string }
  | { type: 'item'; item: TimelineItem };

interface EntryForm {
  /** Heading line of the entry being edited; null when adding. */
  line: number | null;
  date: string;
  title: string;
  kind: ChronicleKind;
  where: string[];
  with: string[];
  books: string[];
  body: string;
}

interface QuickParse {
  date: WorldSpan | null;
  dateText: string;
  dateInvalid: boolean;
  title: string;
  where: string[];
  with: string[];
  unknownPlaces: string[];
  unknownPeople: string[];
}

/** Gaps of at least this many years between consecutive entries collapse to a marker. */
const QUIET_YEARS = 15;
const QUICK_DATE_RE = /^\s*((?:c\.\s*|~\s*)?-?\d{1,6}(?:-\d{1,3}){0,2}(?:\s*(?:→|->|\.\.)\s*(?:c\.\s*)?-?\d{1,6}(?:-\d{1,3}){0,2})?)\s+/i;

/**
 * Chronicle: the world's history as one era-grouped stream. Authored entries come from the
 * chronicle file; births, deaths, House reigns and book spans are derived from other records.
 */
@Component({
  selector: 'app-chronicle-view',
  imports: [FormsModule, RouterLink, PovChipComponent],
  templateUrl: './chronicle-view.component.html',
  styleUrl: './chronicle-view.component.scss',
})
export class ChronicleViewComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly timeline = inject(TimelineService);
  private readonly characterService = inject(CharacterService);
  private readonly projects = inject(ProjectService);
  private readonly electron = inject(ElectronService);
  private readonly modal = inject(ModalService);
  private readonly notifications = inject(NotificationService);
  private readonly logger = inject(LoggingService);

  @ViewChild('stream') stream?: ElementRef<HTMLElement>;
  @ViewChild('quickInput') quickInput?: ElementRef<HTMLInputElement>;

  readonly kindLabels = KIND_LABELS;
  readonly kindFilters: { id: KindFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'event', label: 'Events' },
    { id: 'life', label: 'Births & deaths' },
    { id: 'reign', label: 'Reigns' },
    { id: 'book', label: 'Books' },
    { id: 'legend', label: 'Legends' },
  ];

  ctx: TimelineContext | null = null;
  loaded = false;
  private items: TimelineItem[] = [];
  rows: StreamRow[] = [];
  groups: EraGroup[] = [];
  undated: TimelineItem[] = [];
  visibleCount = 0;
  totalCount = 0;
  currentEra = -2;

  kind: KindFilter = 'all';
  query = '';
  personId = '';
  bookId = '';
  showDerived = true;

  selectedKey: string | null = null;
  form: EntryForm | null = null;
  formError = '';
  private formSnapshot = '';
  saving = false;

  composerOpen = false;
  quickText = '';
  quick: QuickParse | null = null;

  private readonly portraits = new TimelinePortraits(this.characterService);
  private pendingScrollKey: string | null = null;

  ngOnInit(): void {
    void this.timeline.ensureLoaded();
    this.timeline.context$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ctx) => {
      this.ctx = ctx;
      this.loaded = !!ctx.chronicle;
      this.items = buildTimelineItems({
        calendar: ctx.calendar,
        chronicle: ctx.chronicle?.parsed ?? null,
        characters: ctx.characters,
        houses: ctx.houses,
        books: ctx.books,
        plans: ctx.plans,
        resolve: ctx.resolve,
      });
      this.rebuild();
      const people = new Set(this.items.flatMap((i) => i.people));
      void this.portraits.load(ctx.characters.filter((c) => people.has(c.id)));
    });
  }

  // ------------------------------------------------------------ derived view state

  get calendarLabel(): string {
    const cal = this.ctx?.calendar;
    return cal?.name ? `${cal.name}${cal.suffix ? ` (${cal.suffix})` : ''}` : 'Calendar';
  }

  get chronicleExists(): boolean {
    return !!this.ctx?.chronicle?.exists;
  }

  get chroniclePath(): string {
    return this.ctx?.chronicle?.relativePath ?? this.timeline.chronicleRelativePath();
  }

  get people(): Character[] {
    return this.ctx?.characters ?? [];
  }

  get selected(): TimelineItem | null {
    return this.items.find((i) => i.key === this.selectedKey) ?? null;
  }

  rebuild(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const query = this.query.trim().toLowerCase();
    const visible = this.items.filter((item) => {
      if (!this.showDerived && item.entryLine === undefined) return false;
      if (this.kind === 'life' ? !(item.kind === 'birth' || item.kind === 'death') : this.kind !== 'all' && item.kind !== this.kind) return false;
      if (this.personId && !item.people.includes(this.personId)) return false;
      if (this.bookId && !item.books.includes(this.bookId)) return false;
      if (query) {
        const haystack = [
          item.title,
          item.body,
          ...item.people.map((id) => ctx.charactersById.get(id)?.name ?? ''),
          ...item.places.map((id) => ctx.locationsById.get(id)?.name ?? ''),
          ...item.unresolved,
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    this.totalCount = this.items.length;
    this.visibleCount = visible.length;
    this.undated = visible.filter((i) => !i.range);

    const eras = ctx.chronicle?.parsed.eras ?? [];
    const groups = new Map<number, EraGroup>();
    const groupFor = (index: number): EraGroup => {
      let group = groups.get(index);
      if (!group) {
        const era = eras[index];
        group = { index, title: era?.title ?? 'Before the first era', description: era?.description ?? '', range: '', items: [] };
        groups.set(index, group);
      }
      return group;
    };
    for (const item of visible) if (item.range) groupFor(eras.length ? item.eraIndex : -1).items.push(item);
    // Eras without visible entries still show in the rail (and as empty headers when unfiltered).
    if (!this.isFiltered) eras.forEach((_, i) => groupFor(i));

    this.groups = [...groups.values()].sort((a, b) => a.index - b.index);
    const rows: StreamRow[] = [];
    const yearDays = daysInYear(ctx.calendar);
    for (const group of this.groups) {
      group.items.sort((a, b) => a.range!.start - b.range!.start || (a.entryLine ?? Infinity) - (b.entryLine ?? Infinity));
      if (group.items.length) {
        const first = group.items[0].range!.start;
        const last = Math.max(...group.items.map((i) => i.range!.end));
        const a = Math.floor(first / yearDays);
        const b = Math.floor(last / yearDays);
        group.range = a === b ? formatYear(a) : `${formatYear(a)} – ${formatYear(b)}`;
      }
      if (eras.length || this.groups.length > 1) rows.push({ type: 'era', group });
      let previous: TimelineItem | null = null;
      for (const item of group.items) {
        if (previous) {
          const years = Math.floor((item.range!.start - previous.range!.end) / yearDays);
          if (years >= QUIET_YEARS) rows.push({ type: 'gap', years, key: `gap:${item.key}` });
        }
        rows.push({ type: 'item', item });
        previous = item;
      }
    }
    this.rows = rows;
    if (this.selectedKey && !this.items.some((i) => i.key === this.selectedKey)) this.selectedKey = null;
    if (!this.selectedKey && !this.form) this.selectedKey = visible.find((i) => i.entryLine !== undefined)?.key ?? visible[0]?.key ?? null;
    if (this.pendingScrollKey) {
      const key = this.pendingScrollKey;
      this.pendingScrollKey = null;
      setTimeout(() => this.scrollToItem(key));
    }
    setTimeout(() => this.syncEra());
  }

  get isFiltered(): boolean {
    return this.kind !== 'all' || !!this.query.trim() || !!this.personId || !!this.bookId;
  }

  setKind(kind: KindFilter): void {
    this.kind = kind;
    this.rebuild();
  }

  clearFilters(): void {
    this.kind = 'all';
    this.query = '';
    this.personId = '';
    this.bookId = '';
    this.showDerived = true;
    this.rebuild();
  }

  trackRow(row: StreamRow): string {
    return row.type === 'era' ? `era:${row.group.index}` : row.type === 'gap' ? row.key : row.item.key;
  }

  // ------------------------------------------------------------ display helpers

  dateParts(item: TimelineItem): { year: string; rest: string; approx: boolean } {
    const cal = this.ctx!.calendar;
    const start = item.date!.start;
    const end = item.date!.end;
    const month = start.month !== undefined ? shortMonthName(cal, start.month) : '';
    let rest = month + (start.day !== undefined ? ` ${start.day}` : '');
    if (end) rest += `${rest ? ' ' : ''}→ ${end.year !== start.year ? formatYear(end.year) : ''}${end.month !== undefined && end.year === start.year ? shortMonthName(cal, end.month) : ''}`;
    return { year: formatYear(start.year), rest: rest.trim(), approx: !!start.approx };
  }

  formatDate(item: TimelineItem): string {
    return item.date ? formatWorldSpan(item.date, this.ctx!.calendar, { suffix: true }) : item.dateInvalid ? 'Unreadable date' : 'Undated';
  }

  itemColor(item: TimelineItem): string {
    if (item.kind === 'book') return this.ctx?.books.find((b) => b.id === item.books[0])?.color || 'var(--color-info)';
    if (item.kind === 'reign') {
      const house = this.ctx?.houses.find((h) => h.id === item.houses[0]);
      return house?.colors[0] || 'var(--color-info)';
    }
    return '';
  }

  /** Entry text with `[[Target|label]]` shown as its label. */
  plainBody(text: string): string {
    return text.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target: string, label?: string) => (label || target).split('#')[0]);
  }

  personName(id: string): string {
    return this.ctx?.charactersById.get(id)?.name ?? id;
  }

  placeName(id: string): string {
    return this.ctx?.locationsById.get(id)?.name ?? id;
  }

  houseName(id: string): string {
    return this.ctx?.houses.find((h) => h.id === id)?.name ?? id;
  }

  bookName(id: string): string {
    return this.ctx?.books.find((b) => b.id === id)?.name ?? id;
  }

  bookColor(id: string): string {
    return this.ctx?.books.find((b) => b.id === id)?.color ?? 'var(--color-text-muted)';
  }

  portrait(id: string): string | null {
    return this.portraits.get(id);
  }

  /** Age of each linked person at the start of an item. */
  agesFor(item: TimelineItem): { id: string; name: string; text: string; tone: '' | 'muted' | 'warn' }[] {
    const ctx = this.ctx!;
    return item.people.map((id) => {
      const person = ctx.charactersById.get(id);
      const name = person?.name ?? id;
      if (!item.date || !person?.born) return { id, name, text: person?.lore ? 'Lore' : 'age unknown', tone: 'muted' as const };
      const born = parseWorldSpan(person.born, ctx.calendar)?.start ?? null;
      const died = person.died ? parseWorldSpan(person.died, ctx.calendar)?.start ?? null : null;
      const at = dateToYear(item.date.start, ctx.calendar, 'start');
      if (!born) return { id, name, text: 'age unknown', tone: 'muted' as const };
      if (item.kind === 'birth') return { id, name, text: 'born', tone: '' as const };
      const bornAt = dateToYear(born, ctx.calendar, 'start');
      if (at < bornAt) return { id, name, text: `not born yet (${formatYear(born.year)})`, tone: 'warn' as const };
      if (died && at > dateToYear(died, ctx.calendar, 'end')) return { id, name, text: `died ${formatYear(died.year)}`, tone: 'warn' as const };
      return { id, name, text: `age ${ageAt(born, at, ctx.calendar)}`, tone: '' as const };
    });
  }

  eraTitle(item: TimelineItem): string {
    const eras = this.ctx?.chronicle?.parsed.eras ?? [];
    return eras[item.eraIndex]?.title ?? '';
  }

  /** The entry as it is written in the chronicle file. */
  sourceText(item: TimelineItem): string {
    const entry = this.ctx?.chronicle?.parsed.entries.find((e) => e.line === item.entryLine);
    if (!entry) return '';
    return formatChronicleEntry({ date: entry.date, title: entry.title, kind: entry.kind, where: entry.where, with: entry.with, books: entry.books, body: entry.body })
      .replace(/^## [^·]*·/, `## ${entry.dateText || '?'} ·`);
  }

  // ------------------------------------------------------------ selection & scrolling

  private inlineEditing = false;

  @HostListener('document:click', ['$event'])
  async onOutsideEditorClick(event: MouseEvent): Promise<void> {
    if (!this.inlineEditing || !this.form || this.saving) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.entry-form, .inline-title')) return;
    await this.saveForm();
  }

  async select(item: TimelineItem): Promise<void> {
    if (item.key === this.selectedKey) return;
    if (this.inlineEditing && this.form) {
      await this.saveForm();
      if (this.form) return;
    } else if (!(await this.confirmDiscard())) return;
    this.form = null;
    this.selectedKey = item.key;
  }

  onStreamScroll(): void {
    this.syncEra();
  }

  jumpToEra(group: EraGroup): void {
    const el = this.stream?.nativeElement.querySelector<HTMLElement>(`[data-era="${group.index}"]`);
    if (el && this.stream) this.stream.nativeElement.scrollTo({ top: Math.max(0, el.offsetTop - 4), behavior: 'smooth' });
  }

  jumpToUndated(): void {
    const el = this.stream?.nativeElement.querySelector<HTMLElement>('.undated');
    if (el && this.stream) this.stream.nativeElement.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' });
  }

  private syncEra(): void {
    const host = this.stream?.nativeElement;
    if (!host) return;
    let current = this.groups[0]?.index ?? -2;
    host.querySelectorAll<HTMLElement>('[data-era]').forEach((el) => {
      if (el.offsetTop - host.scrollTop <= 48) current = Number(el.dataset['era']);
    });
    this.currentEra = current;
  }

  private scrollToItem(key: string): void {
    const host = this.stream?.nativeElement;
    const el = host?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (host && el) host.scrollTo({ top: Math.max(0, el.offsetTop - 120), behavior: 'smooth' });
  }

  rangeLabel(group: EraGroup): string {
    return group.range || '—';
  }

  // ------------------------------------------------------------ editing

  async newEntry(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.inlineEditing = false;
    this.form = { line: null, date: '', title: '', kind: 'event', where: [], with: [], books: [], body: '' };
    this.formSnapshot = JSON.stringify(this.form);
    this.formError = '';
  }

  async editEntry(item: TimelineItem, focusTitle = false): Promise<void> {
    if (item.entryLine === undefined) return;
    if (this.form?.line === item.entryLine && this.selectedKey === item.key) return;
    if (!(await this.confirmDiscard())) return;
    const entry = this.ctx?.chronicle?.parsed.entries.find((e) => e.line === item.entryLine);
    if (!entry) return;
    this.inlineEditing = focusTitle;
    this.selectedKey = item.key;
    this.form = {
      line: entry.line,
      date: entry.date ? serializeWorldSpan(entry.date) : entry.dateText,
      title: entry.title,
      kind: entry.kind,
      where: [...entry.where],
      with: [...entry.with],
      books: [...entry.books],
      body: entry.body,
    };
    this.formSnapshot = JSON.stringify(this.form);
    this.formError = '';
    if (focusTitle) {
      setTimeout(() => {
        const input = this.stream?.nativeElement.querySelector<HTMLInputElement>('.inline-title');
        input?.focus();
        input?.select();
      });
    }
  }

  cancelEdit(): void {
    this.inlineEditing = false;
    this.form = null;
    this.formError = '';
  }

  get formDateStatus(): string {
    if (!this.form || !this.ctx) return '';
    const text = this.form.date.trim();
    if (!text) return 'Undated: kept in the Undated tray';
    const span = parseWorldSpan(text, this.ctx.calendar);
    return span ? formatWorldSpan(span, this.ctx.calendar, { suffix: true }) : 'Can’t read this date';
  }

  get formDateInvalid(): boolean {
    return !!this.form && !!this.ctx && !!this.form.date.trim() && !parseWorldSpan(this.form.date, this.ctx.calendar);
  }

  addLink(list: 'where' | 'with', name: string): void {
    if (!this.form || !name) return;
    if (!this.form[list].includes(name)) this.form[list] = [...this.form[list], name];
  }

  removeLink(list: 'where' | 'with', name: string): void {
    if (this.form) this.form[list] = this.form[list].filter((n) => n !== name);
  }

  toggleBook(id: string): void {
    if (!this.form) return;
    this.form.books = this.form.books.includes(id) ? this.form.books.filter((b) => b !== id) : [...this.form.books, id];
  }

  async saveForm(): Promise<void> {
    const form = this.form;
    const ctx = this.ctx;
    if (!form || !ctx || this.saving) return;
    if (!form.title.trim()) {
      this.formError = 'Give the entry a title.';
      return;
    }
    const span = form.date.trim() ? parseWorldSpan(form.date, ctx.calendar) : null;
    if (span === undefined) {
      this.formError = 'Use a date like 322, 322-03, 322-03-09 or c. 322 (ranges with →).';
      return;
    }
    const draft: ChronicleEntryDraft = { date: span, title: form.title, kind: form.kind, where: form.where, with: form.with, books: form.books, body: form.body };
    await this.persist(form.line, draft);
  }

  private async persist(line: number | null, draft: ChronicleEntryDraft): Promise<void> {
    this.saving = true;
    try {
      const at = line === null ? await this.timeline.addEntry(draft) : await this.timeline.updateEntry(line, draft);
      this.inlineEditing = false;
      this.form = null;
      this.formError = '';
      this.selectedKey = `entry:${at}`;
      this.pendingScrollKey = this.selectedKey;
      this.rebuild();
      this.notifications.showSuccess(line === null ? `Added to ${this.chroniclePath}` : 'Entry saved');
    } catch (error) {
      this.formError = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to save chronicle entry', error);
    } finally {
      this.saving = false;
    }
  }

  async deleteEntry(item: TimelineItem): Promise<void> {
    if (item.entryLine === undefined) return;
    const ok = await this.modal.confirm(`Delete “${item.title}” from ${this.chroniclePath}?`, 'Delete entry', { confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await this.timeline.removeEntry(item.entryLine);
      this.selectedKey = null;
      this.form = null;
      this.rebuild();
    } catch (error) {
      this.notifications.showError(error instanceof Error ? error.message : String(error));
    }
  }

  async createChronicle(): Promise<void> {
    try {
      await this.timeline.createChronicle();
      await this.newEntry();
    } catch (error) {
      this.notifications.showError(error instanceof Error ? error.message : String(error));
    }
  }

  async openChronicleFile(): Promise<void> {
    const project = this.projects.getCurrentProject();
    if (!project) return;
    const result = await this.electron.openFileInEditor(pathJoin(project.path, this.chroniclePath));
    if (!result.success) this.notifications.showError(result.error || 'Could not open the chronicle file');
  }

  /** True when there is no unsaved form, or the user agreed to discard it. */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.form || JSON.stringify(this.form) === this.formSnapshot) return true;
    return this.modal.confirm('Discard the changes to this entry?', 'Unsaved entry', { confirmText: 'Discard', danger: true });
  }

  // ------------------------------------------------------------ quick add

  toggleComposer(): void {
    this.composerOpen = !this.composerOpen;
    if (this.composerOpen) setTimeout(() => this.quickInput?.nativeElement.focus());
  }

  onQuickInput(): void {
    this.quick = this.quickText.trim() ? this.parseQuick(this.quickText) : null;
  }

  onQuickKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.composerOpen = false;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void this.addQuick();
    }
  }

  async addQuick(): Promise<void> {
    const parsed = this.quickText.trim() ? this.parseQuick(this.quickText) : null;
    if (!parsed?.title) {
      this.notifications.showError('Give the entry a title.');
      return;
    }
    if (parsed.dateInvalid) {
      this.notifications.showError(`Can’t read the date “${parsed.dateText}”.`);
      return;
    }
    await this.persist(null, {
      date: parsed.date,
      title: parsed.title,
      kind: 'event',
      where: parsed.where,
      with: parsed.with,
      books: [],
      body: '',
    });
    this.quickText = '';
    this.quick = null;
  }

  /** `322-03 The blackout @Vellhaven +Mara +Saffi`: date, title, places and people by name prefix. */
  parseQuick(text: string): QuickParse {
    const ctx = this.ctx!;
    let rest = text;
    let date: WorldSpan | null = null;
    let dateText = '';
    let dateInvalid = false;
    const match = QUICK_DATE_RE.exec(rest);
    if (match) {
      dateText = match[1].trim();
      const span = parseWorldSpan(dateText, ctx.calendar);
      date = span ?? null;
      dateInvalid = span === undefined;
      rest = rest.slice(match[0].length);
    }
    const where: string[] = [];
    const withPeople: string[] = [];
    const unknownPlaces: string[] = [];
    const unknownPeople: string[] = [];
    rest = rest.replace(/@([^@+]+?)(?=\s+[@+]|$)/g, (_, raw: string) => {
      const term = raw.trim().toLowerCase();
      const place = ctx.locations.find((l) => l.name.toLowerCase().replace(/^the /, '').startsWith(term) || l.name.toLowerCase().startsWith(term))
        ?? ctx.locations.find((l) => l.name.toLowerCase().includes(term));
      if (place) where.push(place.name);
      else {
        where.push(raw.trim());
        unknownPlaces.push(raw.trim());
      }
      return '';
    });
    rest = rest.replace(/\+(\S+)/g, (_, raw: string) => {
      const term = raw.toLowerCase();
      const person = ctx.characters.find((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(term)))
        ?? ctx.characters.find((c) => (c.aliases ?? []).some((a) => a.toLowerCase().startsWith(term)));
      if (person) {
        if (!withPeople.includes(person.name)) withPeople.push(person.name);
      } else {
        withPeople.push(raw);
        unknownPeople.push(raw);
      }
      return '';
    });
    return { date, dateText, dateInvalid, title: rest.replace(/\s+/g, ' ').trim(), where, with: withPeople, unknownPlaces, unknownPeople };
  }

  quickDateLabel(q: QuickParse): string {
    return q.date ? formatWorldSpan(q.date, this.ctx!.calendar) : '';
  }
}
