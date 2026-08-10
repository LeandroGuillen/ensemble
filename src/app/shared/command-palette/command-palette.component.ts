import {
  Component,
  OnInit,
  HostListener,
  ViewChild,
  ElementRef,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { CommandPaletteService, Command } from './command-palette.service';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-command-palette',
  imports: [FormsModule],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent implements OnInit {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('commandList') commandList?: ElementRef<HTMLDivElement>;

  isOpen = false;
  searchQuery = '';
  commands: Command[] = [];
  filteredCommands: Command[] = [];
  selectedIndex = 0;
  placeholder = 'Type a command or search...';
  enterLabel = 'Execute';
  promptMode = false;

  /** When false, hover must not move selection (keyboard / scroll under cursor). */
  private pointerSelectEnabled = false;
  private lastPointerX = Number.NaN;
  private lastPointerY = Number.NaN;
  private scrollRafId = 0;

  private readonly destroyRef = inject(DestroyRef);

  constructor(private commandPaletteService: CommandPaletteService) {}

  ngOnInit(): void {
    this.commandPaletteService.isOpen$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isOpen) => {
        this.isOpen = isOpen;
        if (isOpen) {
          this.searchQuery = '';
          this.selectedIndex = 0;
          this.pointerSelectEnabled = false;
          this.lastPointerX = Number.NaN;
          this.lastPointerY = Number.NaN;
          setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
          this.filterCommands();
        }
      });

    this.commandPaletteService.commands$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((commands) => {
        this.commands = commands;
        this.filterCommands();
      });

    this.commandPaletteService.placeholder$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((p) => (this.placeholder = p));

    this.commandPaletteService.enterLabel$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((l) => (this.enterLabel = l));

    this.commandPaletteService.promptMode$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((promptMode) => {
        this.promptMode = promptMode;
        this.filterCommands();
      });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveSelection(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveSelection(-1);
        break;
      case 'PageDown':
        event.preventDefault();
        this.moveSelection(this.pageStep());
        break;
      case 'PageUp':
        event.preventDefault();
        this.moveSelection(-this.pageStep());
        break;
      case 'Home':
        event.preventDefault();
        this.moveSelectionTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.moveSelectionTo(this.filteredCommands.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        this.executeSelectedCommand();
        break;
    }
  }

  onSearchChange(): void {
    this.selectedIndex = 0;
    this.filterCommands();
  }

  onListMouseMove(event: MouseEvent): void {
    if (
      event.clientX === this.lastPointerX &&
      event.clientY === this.lastPointerY
    ) {
      return;
    }
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.pointerSelectEnabled = true;
  }

  onItemMouseEnter(index: number): void {
    if (!this.pointerSelectEnabled) return;
    this.selectedIndex = index;
  }

  filterCommands(): void {
    if (this.promptMode) {
      this.filteredCommands = [];
      return;
    }

    const query = this.searchQuery.toLowerCase().trim();

    if (!query) {
      this.filteredCommands = [...this.commands];
    } else {
      this.filteredCommands = this.commands
        .filter((cmd) => {
          const labelMatch = cmd.label.toLowerCase().includes(query);
          const keywordMatch = cmd.keywords?.some((kw) =>
            kw.toLowerCase().includes(query)
          );
          return labelMatch || keywordMatch;
        })
        .sort((a, b) => {
          const aLabel = a.label.toLowerCase();
          const bLabel = b.label.toLowerCase();
          const aStarts = aLabel.startsWith(query);
          const bStarts = bLabel.startsWith(query);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          const aInLabel = aLabel.includes(query);
          const bInLabel = bLabel.includes(query);
          if (aInLabel !== bInLabel) return aInLabel ? -1 : 1;
          return aLabel.localeCompare(bLabel);
        });
    }

    if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = Math.max(0, this.filteredCommands.length - 1);
    }
  }

  executeCommand(command: Command): void {
    command.action();
    this.close();
  }

  executeSelectedCommand(): void {
    if (this.promptMode) {
      this.commandPaletteService.submitPrompt(this.searchQuery);
      return;
    }

    if (
      this.filteredCommands.length > 0 &&
      this.selectedIndex < this.filteredCommands.length
    ) {
      this.executeCommand(this.filteredCommands[this.selectedIndex]);
    }
  }

  close(): void {
    this.commandPaletteService.close();
  }

  onBackdropClick(): void {
    this.close();
  }

  onPaletteClick(event: Event): void {
    event.stopPropagation();
  }

  private pageStep(): number {
    return PAGE_SIZE;
  }

  private moveSelection(delta: number): void {
    if (this.filteredCommands.length === 0) return;
    this.moveSelectionTo(this.selectedIndex + delta);
  }

  private moveSelectionTo(index: number): void {
    if (this.filteredCommands.length === 0) return;
    this.pointerSelectEnabled = false;
    this.selectedIndex = Math.max(
      0,
      Math.min(index, this.filteredCommands.length - 1)
    );
    this.scrollToSelected();
  }

  private scrollToSelected(): void {
    if (this.scrollRafId) {
      cancelAnimationFrame(this.scrollRafId);
    }
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = 0;
      const list = this.commandList?.nativeElement;
      if (!list) return;
      const el = list.querySelector('.command-item.selected') as HTMLElement | null;
      if (!el) return;

      // Use viewport rects so padding / offsetParent don't skew scrollTop.
      const listRect = list.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      if (elRect.bottom > listRect.bottom) {
        list.scrollTop += elRect.bottom - listRect.bottom;
      } else if (elRect.top < listRect.top) {
        list.scrollTop -= listRect.top - elRect.top;
      }
    });
  }
}
