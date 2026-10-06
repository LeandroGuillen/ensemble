import { ChangeDetectorRef, Component, DestroyRef, inject, Input, OnInit } from '@angular/core';
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
        <a class="house-link" [routerLink]="['/house', house.id]">{{ house.name }} <span aria-hidden="true">↗</span></a>
      }
    </nav>
  }`, styles: [`
    :host { display: none; }
    :host(.has-houses) { display: block; flex: 0 1 auto; max-width: 100%; }
    .house-links { display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .house-link { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; color: var(--color-accent-primary); text-decoration: none; font-size: 0.75rem; overflow-wrap: anywhere; }
    .house-link:hover { text-decoration: underline; }
    .house-link span { flex-shrink: 0; }
  `] })
export class CharacterHousesComponent implements OnInit {
  @Input() characterId: string | null = null;
  private readonly service = inject(HouseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  houses: House[] = [];

  get assignedHouses(): House[] {
    return this.houses.filter(house => !!this.characterId && house.characterIds.includes(this.characterId));
  }

  ngOnInit(): void {
    this.service.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(houses => {
      this.houses = houses;
      this.cdr.markForCheck();
    });
    void this.service.loadHouses().catch(() => { this.cdr.markForCheck(); });
  }
}
