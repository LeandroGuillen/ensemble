import { ChangeDetectorRef, Component, DestroyRef, EventEmitter, inject, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { House } from '../../core/interfaces/house.interface';
import { HouseService } from '../../core/services/house.service';

@Component({ selector: 'app-character-houses', imports: [RouterLink], template: `
  <section class="houses-panel">
    <h2>Houses</h2>
    <p>Membership applies across books. Select every House this character belongs to.</p>
    @if (error) { <p class="error" role="alert">{{ error }}</p> }
    <div class="house-options">
      @for (house of houses; track house.id) {
        <div class="house-option" [class.selected]="selected.includes(house.id)">
          <label><input type="checkbox" [disabled]="disabled" [checked]="selected.includes(house.id)" (change)="toggle(house.id)" /> {{ house.name }}</label>
          <a [routerLink]="['/house', house.id]" [attr.aria-label]="'Open ' + house.name">↗</a>
        </div>
      } @empty { <p>No Houses yet. <a routerLink="/house">Create a House</a></p> }
    </div>
  </section>`, styles: [`
    .houses-panel { padding: 20px 24px; margin: 0 0 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-secondary); }
    h2 { margin: 0; font-size: 18px; } p { color: var(--color-text-muted); font-size: 13px; }
    .house-options { display: flex; flex-wrap: wrap; gap: 8px; }
    .house-option { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .selected { border-color: var(--color-accent-muted); background: var(--color-accent-subtle); }
    label { display: flex; gap: 8px; cursor: pointer; align-items: center; font-size: 13px; } a { color: var(--color-accent-primary); text-decoration: none; } .error { color: var(--color-error); }
  `] })
export class CharacterHousesComponent implements OnInit, OnChanges {
  @Input() characterId: string | null = null;
  @Input() disabled = false;
  @Output() membershipChange = new EventEmitter<void>();
  private readonly service = inject(HouseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  houses: House[] = [];
  selected: string[] = [];
  private original: string[] = [];
  private touched = false;
  error = '';
  ngOnInit(): void {
    this.service.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(houses => {
      this.houses = houses;
      if (!this.touched) this.reset();
    });
    void this.service.loadHouses().catch(error => { this.error = String(error); this.cdr.markForCheck(); });
  }
  ngOnChanges(changes: SimpleChanges): void {
    const characterChange = changes['characterId'];
    if (characterChange?.previousValue && characterChange.previousValue !== characterChange.currentValue) this.touched = false;
    if (!this.touched) this.reset();
  }
  private reset(): void {
    this.selected = this.houses.filter(house => !!this.characterId && house.characterIds.includes(this.characterId)).map(house => house.id);
    this.original = [...this.selected];
  }
  toggle(id: string): void {
    this.selected = this.selected.includes(id) ? this.selected.filter(value => value !== id) : [...this.selected, id];
    this.touched = true;
    this.membershipChange.emit();
  }
  async save(characterId: string): Promise<void> {
    const changed = [...new Set([...this.original, ...this.selected])].filter(id => this.original.includes(id) !== this.selected.includes(id));
    for (const id of changed) {
      await this.service.setMembership(id, characterId, this.selected.includes(id));
      // Record each successful write so retries after a partial failure are safe.
      this.original = this.selected.includes(id) ? [...new Set([...this.original, id])] : this.original.filter(value => value !== id);
    }
    this.touched = false;
    this.characterId = characterId;
    this.reset();
  }
}
