import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommandPaletteService, Command } from './command-palette.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss'
})
export class CommandPaletteComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  isOpen = false;
  searchQuery = '';
  commands: Command[] = [];
  filteredCommands: Command[] = [];
  selectedIndex = 0;

  private destroy$ = new Subject<void>();

  constructor(private commandPaletteService: CommandPaletteService) {}

  ngOnInit(): void {
    this.commandPaletteService.isOpen$
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
      .subscribe(commands => {
        this.commands = commands;
        this.filterCommands();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Open palette with Ctrl+P or /
    if ((event.ctrlKey && event.key === 'p') || (event.key === '/' && !this.isOpen && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')) {
      event.preventDefault();
      this.commandPaletteService.open();
      return;
    }

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

    this.filteredCommands = this.commands.filter(cmd => {
      const labelMatch = cmd.label.toLowerCase().includes(query);
      const keywordMatch = cmd.keywords?.some(keyword => keyword.toLowerCase().includes(query));
      return labelMatch || keywordMatch;
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
