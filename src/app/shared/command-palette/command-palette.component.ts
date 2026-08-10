import { Component, OnInit, HostListener, ViewChild, ElementRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { CommandPaletteService, Command } from './command-palette.service';
@Component({
    selector: 'app-command-palette',
    imports: [FormsModule],
    templateUrl: './command-palette.component.html',
    styleUrl: './command-palette.component.scss'
})
export class CommandPaletteComponent implements OnInit {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  isOpen = false;
  searchQuery = '';
  commands: Command[] = [];
  filteredCommands: Command[] = [];
  selectedIndex = 0;
  placeholder = 'Type a command or search...';
  enterLabel = 'Execute';

  private readonly destroyRef = inject(DestroyRef);

  constructor(private commandPaletteService: CommandPaletteService) {}

  ngOnInit(): void {
    this.commandPaletteService.isOpen$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(isOpen => {
        this.isOpen = isOpen;
        if (isOpen) {
          this.searchQuery = '';
          this.selectedIndex = 0;
          setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
          this.filterCommands();
        }
      });

    this.commandPaletteService.commands$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(commands => {
        this.commands = commands;
        this.filterCommands();
      });

    this.commandPaletteService.placeholder$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(p => this.placeholder = p);

    this.commandPaletteService.enterLabel$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(l => this.enterLabel = l);
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
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
        this.scrollToSelected();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.scrollToSelected();
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

  filterCommands(): void {
    const query = this.searchQuery.toLowerCase().trim();

    if (!query) {
      this.filteredCommands = [...this.commands];
      return;
    }

    this.filteredCommands = this.commands
      .filter(cmd => {
        const labelMatch = cmd.label.toLowerCase().includes(query);
        const keywordMatch = cmd.keywords?.some(kw => kw.toLowerCase().includes(query));
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

  executeCommand(command: Command): void {
    command.action();
    this.close();
  }

  executeSelectedCommand(): void {
    if (this.filteredCommands.length > 0 && this.selectedIndex < this.filteredCommands.length) {
      this.executeCommand(this.filteredCommands[this.selectedIndex]);
    }
  }

  selectCommand(index: number): void {
    this.selectedIndex = index;
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

  private scrollToSelected(): void {
    setTimeout(() => {
      const element = document.querySelector('.command-item.selected');
      if (element) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }
}
