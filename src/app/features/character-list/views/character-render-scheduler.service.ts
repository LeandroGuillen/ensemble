import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';

/** One budget shared by every group: twenty groups must not each spend a frame. */
@Injectable({ providedIn: 'root' })
export class CharacterRenderScheduler implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly pending = new Set<() => boolean>();
  private paused = false;
  private synchronousCards = 0;
  private synchronousDeadline = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly rendered$ = new Subject<void>();

  renderSmall(step: () => boolean): void {
    if (!this.synchronousCards) this.synchronousDeadline = performance.now() + 8;
    while (!this.paused && this.synchronousCards < 24 && performance.now() < this.synchronousDeadline) {
      this.synchronousCards++;
      if (!step()) return;
    }
    this.enqueue(step);
  }

  enqueue(step: () => boolean): void {
    this.pending.add(step);
    this.schedule();
  }

  cancel(step: () => boolean): void {
    this.pending.delete(step);
    if (!this.pending.size && this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  pause(): void {
    this.paused = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  resume(): void {
    this.paused = false;
    this.schedule();
  }

  private schedule(): void {
    if (this.paused || this.timer !== undefined || !this.pending.size) return;
    // Creating a card checks only its embedded view, not the entire application.
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        const deadline = performance.now() + 8;
        let created = 0;
        while (this.pending.size && created < 12 && performance.now() < deadline) {
          const step = this.pending.values().next().value!;
          this.pending.delete(step);
          if (step()) this.pending.add(step);
          created++;
        }
        this.rendered$.next();
        if (!this.pending.size) this.synchronousCards = 0;
        this.schedule();
      }, 16);
    });
  }

  ngOnDestroy(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.pending.clear();
    this.rendered$.complete();
  }
}
