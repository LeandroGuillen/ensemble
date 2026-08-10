import { Directive, HostBinding, Input, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SettingsSearchService } from './settings-search.service';

/**
 * Hides the host element when the settings search query doesn't match any of the provided terms.
 * When the query is empty, the host stays visible.
 */
@Directive({
  selector: '[settingsSearchable]',
  standalone: true,
})
export class SettingsSearchableDirective implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private terms: string[] = [];
  private visible = true;

  @Input()
  set settingsSearchable(value: string | Array<string | null | undefined | number | boolean> | null | undefined) {
    if (Array.isArray(value)) {
      this.terms = value
        .filter((term) => term !== null && term !== undefined && term !== '')
        .map((term) => String(term));
    } else if (value !== null && value !== undefined && value !== '') {
      this.terms = [String(value)];
    } else {
      this.terms = [];
    }
    this.updateVisibility();
  }

  @HostBinding('hidden')
  get isHidden(): boolean {
    return !this.visible;
  }

  @HostBinding('class.settings-search-miss')
  get isMiss(): boolean {
    return !this.visible;
  }

  constructor(private search: SettingsSearchService) {}

  ngOnInit(): void {
    this.search.query$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.updateVisibility());
  }

  private updateVisibility(): void {
    this.visible = this.search.matches(...this.terms);
  }
}
