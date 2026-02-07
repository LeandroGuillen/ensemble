import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Shortcut {
  keys: string[];
  description: string;
  category: string;
}

@Injectable({
  providedIn: 'root'
})
export class KeyboardShortcutsService {
  private isOpenSubject = new BehaviorSubject<boolean>(false);
  public isOpen$ = this.isOpenSubject.asObservable();

  constructor() {}

  open(): void {
    this.isOpenSubject.next(true);
  }

  close(): void {
    this.isOpenSubject.next(false);
  }

  toggle(): void {
    this.isOpenSubject.next(!this.isOpenSubject.value);
  }

  getAllShortcuts(): Shortcut[] {
    return [
      // Global shortcuts
      {
        keys: ['Ctrl', 'P'],
        description: 'Open command palette',
        category: 'Global'
      },
      {
        keys: ['/'],
        description: 'Open command palette',
        category: 'Global'
      },
      {
        keys: ['Ctrl', '?'],
        description: 'Show keyboard shortcuts',
        category: 'Global'
      },
      {
        keys: ['Esc'],
        description: 'Close dialogs and cancel actions',
        category: 'Global'
      },

      // Character List
      {
        keys: ['N'],
        description: 'Create new character',
        category: 'Character List'
      },
      {
        keys: ['L'],
        description: 'Toggle list/grid view',
        category: 'Character List'
      },
      {
        keys: ['Enter'],
        description: 'Open selected character',
        category: 'Character List'
      },
      {
        keys: ['↑', '↓'],
        description: 'Navigate characters',
        category: 'Character List'
      },

      // Character Detail
      {
        keys: ['Ctrl', 'Enter'],
        description: 'Save character',
        category: 'Character Detail'
      },
      {
        keys: ['Esc'],
        description: 'Cancel editing',
        category: 'Character Detail'
      },

      // Backstage
      {
        keys: ['Ctrl', 'N'],
        description: 'Add new concept',
        category: 'Backstage'
      },
      {
        keys: ['Ctrl', 'Shift', 'N'],
        description: 'Add new name list',
        category: 'Backstage'
      },
      {
        keys: ['Ctrl', 'F'],
        description: 'Focus search',
        category: 'Backstage'
      },
      {
        keys: ['↑', '↓'],
        description: 'Navigate concepts/name lists',
        category: 'Backstage'
      },
      {
        keys: ['Enter'],
        description: 'Focus selected item',
        category: 'Backstage'
      },
      {
        keys: ['Esc'],
        description: 'Exit focus mode',
        category: 'Backstage'
      },

      // Pinboard
      {
        keys: ['P'],
        description: 'Pin character',
        category: 'Pinboard'
      },
      {
        keys: ['Esc'],
        description: 'Close dialogs',
        category: 'Pinboard'
      },

      // Command Palette
      {
        keys: ['↑', '↓'],
        description: 'Navigate commands',
        category: 'Command Palette'
      },
      {
        keys: ['Enter'],
        description: 'Execute selected command',
        category: 'Command Palette'
      },
      {
        keys: ['Esc'],
        description: 'Close command palette',
        category: 'Command Palette'
      }
    ];
  }
}

