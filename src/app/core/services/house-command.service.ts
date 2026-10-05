import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { HouseService } from './house.service';
import { CommandPaletteService } from '../../shared/command-palette/command-palette.service';

@Injectable({ providedIn: 'root' })
export class HouseCommandService {
  private readonly destroyRef = inject(DestroyRef);
  private active = false;
  constructor(private houses: HouseService, private palette: CommandPaletteService, private router: Router) {
    houses.houses$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.publish());
  }
  activate(): void { this.active = true; this.publish(); }
  deactivate(): void { this.active = false; this.publish(); }
  private publish(): void {
    this.palette.replaceGroup('houses', this.active ? [
      { id: 'new-house', label: 'New House', icon: 'plus', keywords: ['create', 'dynasty', 'family'], group: 'houses', action: () => { void this.router.navigate(['/house']); } },
      { id: 'view-houses', label: 'Houses', icon: 'shield', keywords: ['dynasties', 'families'], group: 'houses', action: () => { void this.router.navigate(['/houses']); } },
      ...this.houses.getSnapshot().map(house => ({ id: `house-${house.id}`, label: house.name, icon: 'shield', keywords: ['house', house.motto], group: 'houses', action: () => { void this.router.navigate(['/house', house.id]); } })),
    ] : []);
  }
}
