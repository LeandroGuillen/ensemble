import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TimelineService } from '../../core/services/timeline.service';
import { WorldCalendar } from '../../core/utils/world-date.utils';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { ChronicleViewComponent } from './chronicle-view/chronicle-view.component';
import { LifelinesViewComponent } from './lifelines-view/lifelines-view.component';

export type TimelineView = 'chronicle' | 'lifelines';

/** Timeline page: the Chronicle (world history) and Lifelines (everyone's life on one chart). */
@Component({
  selector: 'app-timeline',
  imports: [RouterLink, PageHeaderComponent, ChronicleViewComponent, LifelinesViewComponent],
  template: `
    <div class="timeline-page">
      <app-page-header title="Timeline">
        <div class="header-actions">
          <button type="button" class="btn btn-secondary btn-sm" (click)="refresh()" [disabled]="refreshing" [attr.aria-busy]="refreshing" title="Reload chronicle and chapter dates from disk">
            {{ refreshing ? 'Refreshing…' : 'Refresh' }}
          </button>
          <div class="view-toggle" role="tablist" aria-label="Timeline view">
            <button type="button" role="tab" [attr.aria-selected]="view === 'chronicle'" (click)="setView('chronicle')">Chronicle</button>
            <button type="button" role="tab" [attr.aria-selected]="view === 'lifelines'" (click)="setView('lifelines')">Lifelines</button>
          </div>
          <a class="calendar-link" routerLink="/settings" [queryParams]="{ section: 'timeline' }" title="Calendar and chronicle file settings">
            {{ calendarLabel }}
          </a>
        </div>
      </app-page-header>
      @if (view === 'chronicle') {
        <app-chronicle-view />
      } @else {
        <app-lifelines-view />
      }
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .timeline-page { display: flex; flex-direction: column; height: 100vh; min-height: 0; }
    .header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .view-toggle {
      display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-tertiary);
      button { border: none; background: none; color: var(--color-text-secondary); font: inherit; font-size: 0.8125rem; padding: 4px 12px; border-radius: var(--radius-sm); cursor: pointer; }
      button[aria-selected='true'] { background: var(--selected-bg); color: var(--selected-fg); box-shadow: inset 0 0 0 1px var(--selected-ring); }
    }
    .calendar-link { font-size: 0.75rem; color: var(--color-text-muted); text-decoration: none; &:hover { color: var(--color-accent-secondary); } }
  `,
})
export class TimelineComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly timeline = inject(TimelineService);
  private readonly destroyRef = inject(DestroyRef);

  view: TimelineView = 'chronicle';
  refreshing = false;
  private calendar: WorldCalendar | null = null;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      this.view = query.get('view') === 'lifelines' ? 'lifelines' : 'chronicle';
    });
    this.timeline.calendar$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((calendar) => (this.calendar = calendar));
  }

  get calendarLabel(): string {
    const cal = this.calendar;
    if (!cal?.name) return `Calendar: ${cal?.months.length ?? 12} months`;
    return `Calendar: ${cal.name}${cal.suffix ? ` (${cal.suffix})` : ''}`;
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.timeline.refresh();
    } finally {
      this.refreshing = false;
    }
  }

  setView(view: TimelineView): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: view === 'chronicle' ? null : view }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
