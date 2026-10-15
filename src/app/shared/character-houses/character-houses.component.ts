import { ChangeDetectorRef, Component, DestroyRef, inject, Input, OnChanges, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { House } from '../../core/interfaces/house.interface';
import { HouseService } from '../../core/services/house.service';

@Component({ selector: 'app-character-houses', imports: [RouterLink], host: {
  '[class.has-houses]': 'assignedHouses.length > 0',
}, template: `
  @if (assignedHouses.length > 0) {
    <nav class="house-links" aria-label="Assigned Houses">
      @for (house of assignedHouses; track house.id) {
        <a class="house-link" [routerLink]="['/house', house.id]" [title]="house.name">
          <span class="house-image">
            @if (crests.get(house.id); as crest) {
              <img [src]="crest" alt="" (error)="crests.delete(house.id)" />
            } @else {
              <svg class="ui-icon" aria-hidden="true"><use href="assets/ui-icons.svg#shield" /></svg>
            }
          </span>
          <span class="house-name">{{ house.name }} <span aria-hidden="true">↗</span></span>
        </a>
      }
    </nav>
  }`, styles: [`
    :host { display: none; }
    :host(.has-houses) { display: block; flex: 0 1 auto; max-width: 100%; }
    .house-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .house-link { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 104px; max-width: 100%; padding: 4px; border-radius: var(--radius-md); color: var(--color-accent-primary); text-decoration: none; font-size: 0.75rem; text-align: center; overflow-wrap: anywhere; }
    .house-link:hover { background: var(--color-bg-secondary); }
    .house-link:hover .house-name { text-decoration: underline; }
    .house-link:focus-visible { outline: 2px solid var(--color-accent-primary); outline-offset: 2px; }
    .house-image { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-secondary); overflow: hidden; }
    .house-image img { width: 100%; height: 100%; object-fit: contain; }
    .house-image .ui-icon { width: 24px; height: 24px; color: var(--color-text-secondary); }
    .house-name { max-width: 100%; line-height: 1.25; }
  `] })
export class CharacterHousesComponent implements OnInit, OnChanges {
  @Input() characterId: string | null = null;
  private readonly service = inject(HouseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  houses: House[] = [];
  crests = new Map<string, string>();
  private crestLoadVersion = 0;

  get assignedHouses(): House[] {
    return this.houses.filter(house => !!this.characterId && house.characterIds.includes(this.characterId));
  }

  ngOnInit(): void {
    this.service.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(houses => {
      this.houses = houses;
      this.loadCrests();
      this.cdr.markForCheck();
    });
    void this.service.loadHouses().catch(() => { this.cdr.markForCheck(); });
  }

  ngOnChanges(): void {
    this.loadCrests();
  }

  private loadCrests(): void {
    const version = ++this.crestLoadVersion;
    this.crests.clear();
    for (const house of this.assignedHouses) {
      void this.service.loadCrest(house).then(url => {
        if (!this.destroyRef.destroyed && version === this.crestLoadVersion) {
          if (url) this.crests.set(house.id, url);
          this.cdr.markForCheck();
        }
      }).catch(() => undefined);
    }
  }
}
