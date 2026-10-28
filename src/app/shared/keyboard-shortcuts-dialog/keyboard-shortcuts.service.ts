import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SHORTCUT_REGISTRY, Shortcut } from './shortcut-registry';

export type { Shortcut };

@Injectable({
  providedIn: 'root'
})
export class KeyboardShortcutsService {
  private isOpenSubject = new BehaviorSubject<boolean>(false);
  public isOpen$ = this.isOpenSubject.asObservable();

  open(): void {
    this.isOpenSubject.next(true);
  }

  close(): void {
    this.isOpenSubject.next(false);
  }

  toggle(): void {
    this.isOpenSubject.next(!this.isOpenSubject.value);
  }

  /** Advertised shortcuts from the shared registry (single source of truth). */
  getAllShortcuts(): Shortcut[] {
    return SHORTCUT_REGISTRY.map((shortcut) => ({ ...shortcut, keys: [...shortcut.keys] }));
  }
}
