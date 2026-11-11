import { Injectable } from '@angular/core';

/** Session-only positions, isolated by project, collection and list preferences. */
@Injectable({ providedIn: 'root' })
export class CharacterListScrollService {
  readonly positions = new Map<string, number>();
}
