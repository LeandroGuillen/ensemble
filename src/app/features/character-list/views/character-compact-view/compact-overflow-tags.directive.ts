import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
} from '@angular/core';

/**
 * Keeps tag pills on one line. Hides overflowing tags from the end and shows +N.
 */
@Directive({
  selector: '[appCompactOverflowTags]',
  standalone: true,
})
export class CompactOverflowTagsDirective implements AfterViewInit, OnDestroy {
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private rafId = 0;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.resizeObserver.observe(el);

    this.mutationObserver = new MutationObserver(() => this.scheduleMeasure());
    this.mutationObserver.observe(el, { childList: true });

    this.scheduleMeasure();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
  }

  private scheduleMeasure(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.measure();
    });
  }

  private measure(): void {
    const host = this.host.nativeElement;
    const tags = Array.from(host.querySelectorAll<HTMLElement>('.tag-xs'));
    const overflow = host.querySelector<HTMLElement>('.tag-overflow');
    if (!tags.length) {
      if (overflow) {
        overflow.hidden = true;
      }
      return;
    }

    // Reset so natural widths can be measured
    for (const tag of tags) {
      tag.hidden = false;
    }
    if (overflow) {
      overflow.hidden = true;
      overflow.textContent = '';
    }

    const available = host.clientWidth;
    if (available <= 0) {
      return;
    }

    const gap = this.readGap(host);
    const widths = tags.map((tag) => tag.offsetWidth);
    const totalWidth = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);

    if (totalWidth <= available) {
      return;
    }

    if (!overflow) {
      return;
    }

    // Reserve space for the widest likely +N badge
    overflow.hidden = false;
    overflow.textContent = `+${tags.length}`;
    const overflowWidth = overflow.offsetWidth;
    let remaining = available - overflowWidth - gap;

    let visibleCount = 0;
    for (let i = 0; i < tags.length; i++) {
      const needed = widths[i] + (visibleCount > 0 ? gap : 0);
      if (needed > remaining) {
        break;
      }
      remaining -= needed;
      visibleCount++;
    }

    const hiddenCount = tags.length - visibleCount;
    for (let i = 0; i < tags.length; i++) {
      tags[i].hidden = i >= visibleCount;
    }

    if (hiddenCount <= 0) {
      overflow.hidden = true;
      overflow.textContent = '';
      return;
    }

    overflow.hidden = false;
    overflow.textContent = `+${hiddenCount}`;
  }

  private readGap(host: HTMLElement): number {
    const raw = getComputedStyle(host).gap || getComputedStyle(host).columnGap || '0';
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
