import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Opens the Create/Edit Character page as a full route. The dialog presentation
 * was removed in favor of a dedicated page; this service stays as the single
 * entry point so callers don't have to know the route shape.
 */
@Injectable({
  providedIn: 'root',
})
export class CharacterEditDialogService {
  constructor(private router: Router) {}

  openEdit(characterId: string): void {
    this.router.navigate(['/character', characterId]);
  }

  openCreate(initialName?: string): void {
    const extras = initialName ? { queryParams: { name: initialName } } : undefined;
    this.router.navigate(['/character'], extras);
  }
}
