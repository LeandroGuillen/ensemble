import { ProjectWriteProtectionService } from './project-write-protection.service';
import { Injectable, inject } from '@angular/core';
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
  private readonly protection = inject(ProjectWriteProtectionService);

  constructor(private router: Router) {}

  openEdit(characterId: string): void {
    this.router.navigate(['/character', characterId]);
  }

  openCreate(initialName?: string): void {
    if (this.protection.readOnlyPath) return;
    const extras = initialName ? { queryParams: { name: initialName } } : undefined;
    this.router.navigate(['/character'], extras);
  }

  openCreateLore(): void {
    if (this.protection.readOnlyPath) return;
    this.router.navigate(['/character'], { queryParams: { lore: 'true' } });
  }

  openEditDraft(characterId: string): void {
    this.router.navigate(['/character-draft', characterId]);
  }

  openCreateDraft(initialName?: string, initialContent?: string): void {
    if (this.protection.readOnlyPath) return;
    const queryParams = initialName ? { name: initialName } : undefined;
    this.router.navigate(['/character-draft'], {
      ...(queryParams ? { queryParams } : {}),
      ...(initialContent ? { state: { initialContent } } : {}),
    });
  }
}
