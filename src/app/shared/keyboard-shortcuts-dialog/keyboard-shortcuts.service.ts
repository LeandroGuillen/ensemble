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

      // Concepts
      {
        keys: ['Ctrl', 'N'],
        description: 'Add new concept',
        category: 'Concepts'
      },
      {
        keys: ['Ctrl', 'F'],
        description: 'Focus search',
        category: 'Concepts'
      },
      {
        keys: ['↑', '↓'],
        description: 'Navigate concepts',
        category: 'Concepts'
      },
      {
        keys: ['Enter'],
        description: 'Select concept',
        category: 'Concepts'
      },

      // Names
      {
        keys: ['Ctrl', 'N'],
        description: 'Add new name list',
        category: 'Names'
      },
      {
        keys: ['Ctrl', 'F'],
        description: 'Focus search',
        category: 'Names'
      },
      {
        keys: ['↑', '↓'],
        description: 'Navigate name lists / names',
        category: 'Names'
      },
      {
        keys: ['Enter'],
        description: 'Edit selected name',
        category: 'Names'
      },
      {
        keys: ['C'],
        description: 'Edit name comment',
        category: 'Names'
      },
      {
        keys: ['S'],
        description: 'Toggle strikethrough',
        category: 'Names'
      },
      {
        keys: ['N'],
        description: 'Focus add-name input',
        category: 'Names'
      },
      {
        keys: ['Del'],
        description: 'Delete selected name',
        category: 'Names'
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

