import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ParsedBookPlan, PlanMarker } from '../../../core/interfaces/book-plan.interface';
import {
  PlanSearchCharacter,
  PlanSearchGroup,
  PlanSearchItem,
  searchPlan,
} from '../../../core/utils/plan-search.utils';
import { PovChipComponent } from '../pov-chip.component';

interface TextSegment {
  text: string;
  hit: boolean;
}

export const PLAN_MARKER_LABELS: Record<PlanMarker, string> = {
  todo: 'TODO',
  ojo: 'OJO',
  oculto: 'oculto',
  relectura: 'RE-LECTURA',
  lugar: 'lugar',
  objetivo: 'objetivo',
};

/** Keyboard-first search over a book plan (Ctrl+J on the book page). */
@Component({
  selector: 'app-plan-search',
  imports: [FormsModule, PovChipComponent],
  templateUrl: './plan-search.component.html',
  styleUrl: './plan-search.component.scss',
})
export class PlanSearchComponent implements AfterViewInit {
  @Input({ required: true }) plan!: ParsedBookPlan;
  @Input() characters: PlanSearchCharacter[] = [];
  /** PoV character id → portrait data URL. */
  @Input() thumbnails: ReadonlyMap<string, string> = new Map();
  @Input() initialQuery = '';
  /** 0-based plan line to jump to. */
  @Output() pick = new EventEmitter<number>();
  @Output() dismiss = new EventEmitter<void>();

  @ViewChild('input') input?: ElementRef<HTMLInputElement>;
  @ViewChild('list') list?: ElementRef<HTMLElement>;

  readonly markerLabels = PLAN_MARKER_LABELS;
  readonly lenses = [
    { query: '2180', label: 'chapter' },
    { query: '@', label: 'character' },
    { query: '!todo', label: 'TODOs' },
    { query: '!oculto', label: 'hidden info' },
    { query: '!relectura', label: 'rereading' },
    { query: '!ojo', label: 'continuity' },
    { query: '!lugar', label: 'places' },
  ];

  query = '';
  groups: PlanSearchGroup[] = [];
  /** Flat list of items in display order, for keyboard selection. */
  flat: PlanSearchItem[] = [];
  selected = 0;

  ngAfterViewInit(): void {
    this.query = this.initialQuery;
    this.run();
    setTimeout(() => this.input?.nativeElement.select());
  }

  run(): void {
    this.groups = searchPlan(this.plan, this.query, this.characters);
    this.flat = this.groups.flatMap((g) => g.items);
    this.selected = 0;
  }

  applyLens(query: string): void {
    this.query = query === '2180' ? '' : query;
    this.run();
    this.input?.nativeElement.focus();
  }

  isSelected(item: PlanSearchItem): boolean {
    return this.flat[this.selected] === item;
  }

  choose(item: PlanSearchItem | undefined): void {
    if (item) this.pick.emit(item.line);
  }

  segments(item: PlanSearchItem): TextSegment[] {
    const out: TextSegment[] = [];
    let pos = 0;
    for (const [from, to] of item.highlights) {
      if (from > pos) out.push({ text: item.text.slice(pos, from), hit: false });
      out.push({ text: item.text.slice(from, to), hit: true });
      pos = to;
    }
    if (pos < item.text.length) out.push({ text: item.text.slice(pos), hit: false });
    return out;
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.dismiss.emit();
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        return;
      case 'PageDown':
        event.preventDefault();
        this.move(10);
        return;
      case 'PageUp':
        event.preventDefault();
        this.move(-10);
        return;
      case 'Tab':
        event.preventDefault();
        this.jumpGroup(event.shiftKey ? -1 : 1);
        return;
      case 'Enter':
        event.preventDefault();
        this.choose(this.flat[this.selected]);
        return;
    }
  }

  private move(delta: number): void {
    if (!this.flat.length) return;
    this.selected = Math.max(0, Math.min(this.flat.length - 1, this.selected + delta));
    this.scrollToSelected();
  }

  /** Select the first item of the next / previous group. */
  private jumpGroup(direction: 1 | -1): void {
    if (!this.groups.length) return;
    const current = this.groups.findIndex((g) => g.items.includes(this.flat[this.selected]));
    const next = (current + direction + this.groups.length) % this.groups.length;
    this.selected = this.flat.indexOf(this.groups[next].items[0]);
    this.scrollToSelected();
  }

  private scrollToSelected(): void {
    setTimeout(() => {
      this.list?.nativeElement.querySelector('.plan-search-item.selected')?.scrollIntoView({ block: 'nearest' });
    });
  }
}
