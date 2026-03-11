import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface CharacterEditDialogState {
  mode: 'edit' | 'create';
  characterId: string | null;
  initialName?: string;
}

/**
 * Service to open the Edit/Create Character UI as a floating dialog
 * over the current page, preserving scroll and view state.
 * Pushes a history state when opening so the browser back button closes the dialog.
 */
@Injectable({
  providedIn: 'root',
})
export class CharacterEditDialogService {
  private stateSubject = new BehaviorSubject<CharacterEditDialogState | null>(null);
  readonly state$: Observable<CharacterEditDialogState | null> = this.stateSubject.asObservable();

  private popstateListener = (): void => {
    if (this.stateSubject.value !== null) {
      this.stateSubject.next(null);
    }
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.popstateListener);
    }
  }

  openEdit(characterId: string): void {
    this.pushDialogState();
    this.stateSubject.next({ mode: 'edit', characterId });
  }

  openCreate(initialName?: string): void {
    this.pushDialogState();
    this.stateSubject.next({ mode: 'create', characterId: null, initialName });
  }

  close(): void {
    this.stateSubject.next(null);
    this.popDialogState();
  }

  get currentState(): CharacterEditDialogState | null {
    return this.stateSubject.value;
  }

  private pushDialogState(): void {
    if (typeof history !== 'undefined' && typeof window !== 'undefined') {
      const url = window.location.pathname + window.location.search + window.location.hash;
      history.pushState({ characterEditDialog: true }, '', url);
    }
  }

  private popDialogState(): void {
    if (typeof history !== 'undefined') {
      history.back();
    }
  }
}
