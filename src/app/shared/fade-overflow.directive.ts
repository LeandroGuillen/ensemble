import {
  AfterViewInit,
  ChangeDetectorRef,
  Directive,
  ElementRef,
  HostBinding,
  NgZone,
  OnDestroy,
} from '@angular/core';

/**
 * Adds `.is-faded` when text is horizontally clipped, so CSS can fade the cut edge.
 */
@Directive({
  selector: '[appFadeOverflow]',
  standalone: true,
})
export class FadeOverflowDirective implements AfterViewInit, OnDestroy {
  @HostBinding('class.is-faded') isFaded = false;

  private resizeObserver?: ResizeObserver;
  private rafId = 0;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef,
    private readonly ngZone: NgZone
  ) {}

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    this.ngZone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
      this.resizeObserver.observe(el);
      if (el.parentElement) {
        this.resizeObserver.observe(el.parentElement);
      }
    });
    this.scheduleMeasure();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
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
      const el = this.host.nativeElement;
      const next = el.scrollWidth > el.clientWidth + 1;
      if (next === this.isFaded) {
        return;
      }
      this.ngZone.run(() => {
        this.isFaded = next;
        this.cdr.markForCheck();
      });
    });
  }
}
