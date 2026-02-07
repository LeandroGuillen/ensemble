import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { KeyboardShortcutsService, Shortcut } from './keyboard-shortcuts.service';

@Component({
  selector: 'app-keyboard-shortcuts-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './keyboard-shortcuts-dialog.component.html',
  styleUrls: ['./keyboard-shortcuts-dialog.component.scss']
})
export class KeyboardShortcutsDialogComponent implements OnInit, OnDestroy {
  isOpen = false;
  shortcuts: Shortcut[] = [];
  groupedShortcuts: { [category: string]: Shortcut[] } = {};

  private destroy$ = new Subject<void>();

  constructor(private shortcutsService: KeyboardShortcutsService) {}

  ngOnInit(): void {
    this.shortcutsService.isOpen$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isOpen => {
        this.isOpen = isOpen;
        if (isOpen) {
          this.loadShortcuts();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  private loadShortcuts(): void {
    this.shortcuts = this.shortcutsService.getAllShortcuts();
    this.groupShortcuts();
  }

  private groupShortcuts(): void {
    this.groupedShortcuts = {};
    this.shortcuts.forEach(shortcut => {
      if (!this.groupedShortcuts[shortcut.category]) {
        this.groupedShortcuts[shortcut.category] = [];
      }
      this.groupedShortcuts[shortcut.category].push(shortcut);
    });
  }

  getCategories(): string[] {
    return Object.keys(this.groupedShortcuts);
  }

  close(): void {
    this.shortcutsService.close();
  }

  onBackdropClick(): void {
    this.close();
  }

  onDialogClick(event: Event): void {
    event.stopPropagation();
  }

  formatKey(key: string): string {
    // Format keys for display
    const keyMap: { [key: string]: string } = {
      'ctrl': 'Ctrl',
      'meta': 'Cmd',
      'shift': 'Shift',
      'alt': 'Alt',
      'escape': 'Esc',
      'enter': 'Enter',
      'arrowup': '↑',
      'arrowdown': '↓',
      'arrowleft': '←',
      'arrowright': '→',
    };

    const lowerKey = key.toLowerCase();
    return keyMap[lowerKey] || key.toUpperCase();
  }
}

