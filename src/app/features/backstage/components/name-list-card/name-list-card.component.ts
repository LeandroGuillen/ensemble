import { Component, Input, Output, EventEmitter, HostListener } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { NameList, NameWithNotes } from "../../../../core/interfaces/backstage.interface";

@Component({
  selector: "app-name-list-card",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./name-list-card.component.html",
  styleUrls: ["./name-list-card.component.scss"],
})
export class NameListCardComponent {
  @Input() nameList!: NameList;
  @Input() index!: number;
  @Input() isFocused = false;
  @Input() isDimmed = false;
  @Input() isSelected = false;
  @Input() focusedNameIndex: number | null = null;
  @Output() update = new EventEmitter<Partial<NameList>>();
  @Output() delete = new EventEmitter<void>();
  @Output() takeTheStage = new EventEmitter<string>();
  @Output() focus = new EventEmitter<void>();
  @Output() exitFocus = new EventEmitter<void>();

  newNameInput = "";
  isCollapsed = false;
  expandedNotes: Set<number> = new Set();
  selectedNameIndex: number | null = null;
  bulkAddMode = false;
  bulkInputText = "";

  onTitleChange(title: string): void {
    this.update.emit({ title });
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  toggleNotes(index: number): void {
    if (this.expandedNotes.has(index)) {
      this.expandedNotes.delete(index);
    } else {
      this.expandedNotes.add(index);
    }
  }

  hasNotes(index: number): boolean {
    return !!this.nameList.names[index]?.notes;
  }

  isNotesExpanded(index: number): boolean {
    return this.expandedNotes.has(index);
  }

  onAddName(): void {
    if (this.newNameInput.trim()) {
      const names = [...this.nameList.names, { name: this.newNameInput.trim() }];
      this.update.emit({ names });
      this.newNameInput = "";
    }
  }

  toggleBulkAddMode(): void {
    this.bulkAddMode = !this.bulkAddMode;
    if (!this.bulkAddMode) {
      this.bulkInputText = "";
    }
  }

  onBulkAdd(): void {
    if (!this.bulkInputText.trim()) {
      return;
    }

    // Parse multiple formats: one per line, comma-separated, semicolon-separated
    const lines = this.bulkInputText.split(/\n/);
    const newNames: Array<{ name: string; notes?: string }> = [];

    for (const line of lines) {
      // Try comma-separated first
      const commaSeparated = line.split(",").map((s) => s.trim()).filter((s) => s);
      if (commaSeparated.length > 1) {
        newNames.push(...commaSeparated.map((name) => ({ name })));
        continue;
      }

      // Try semicolon-separated
      const semicolonSeparated = line.split(";").map((s) => s.trim()).filter((s) => s);
      if (semicolonSeparated.length > 1) {
        newNames.push(...semicolonSeparated.map((name) => ({ name })));
        continue;
      }

      // Single line - check if it's markdown with sub-bullets
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        const name = trimmed.substring(2).trim();
        newNames.push({ name });
      } else if (trimmed) {
        // Plain text line
        newNames.push({ name: trimmed });
      }
    }

    if (newNames.length > 0) {
      const names = [...this.nameList.names, ...newNames];
      this.update.emit({ names });
      this.bulkInputText = "";
      this.bulkAddMode = false;
    }
  }

  onNameChange(index: number, newName: string): void {
    if (newName.trim()) {
      const names = [...this.nameList.names];
      names[index] = {
        ...names[index],
        name: newName.trim(),
      };
      this.update.emit({ names });
    }
  }

  onNotesChange(index: number, notes: string): void {
    const names = [...this.nameList.names];
    names[index] = {
      ...names[index],
      notes: notes.trim() || undefined,
    };
    this.update.emit({ names });
  }

  onRemoveName(index: number): void {
    const names = this.nameList.names.filter((_, i) => i !== index);
    this.update.emit({ names });
    this.expandedNotes.delete(index);
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.delete.emit();
  }

  onTakeTheStage(name: string, event: Event): void {
    event.stopPropagation();
    this.takeTheStage.emit(name);
  }

  onFocus(): void {
    this.focus.emit();
  }

  @HostListener("keydown", ["$event"])
  handleKeyDown(event: KeyboardEvent): void {
    if (!this.isFocused) {
      return;
    }

    // Don't handle if user is typing in an input/textarea
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      // Allow Escape to exit focus mode
      if (event.key === "Escape") {
        event.preventDefault();
        this.exitFocus.emit();
      }
      return;
    }

    const currentIndex = this.selectedNameIndex ?? -1;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        if (currentIndex > 0) {
          this.selectedNameIndex = currentIndex - 1;
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        if (currentIndex < this.nameList.names.length - 1) {
          this.selectedNameIndex = currentIndex + 1;
        }
        break;
      case "PageUp":
        event.preventDefault();
        this.selectedNameIndex = Math.max(0, currentIndex - 10);
        break;
      case "PageDown":
        event.preventDefault();
        this.selectedNameIndex = Math.min(
          this.nameList.names.length - 1,
          currentIndex + 10
        );
        break;
      case "Enter":
        event.preventDefault();
        if (currentIndex >= 0 && currentIndex < this.nameList.names.length) {
          // Focus the name input
          const input = document.querySelector(
            `[data-name-index="${currentIndex}"]`
          ) as HTMLInputElement;
          input?.focus();
        } else {
          // Focus the new name input
          const newInput = document.querySelector(
            `[data-new-name-input]`
          ) as HTMLInputElement;
          newInput?.focus();
        }
        break;
      case "Escape":
        event.preventDefault();
        this.exitFocus.emit();
        break;
      case "Delete":
      case "Backspace":
        if (currentIndex >= 0 && currentIndex < this.nameList.names.length) {
          event.preventDefault();
          if (confirm("Delete this name?")) {
            this.onRemoveName(currentIndex);
            if (this.selectedNameIndex !== null) {
              this.selectedNameIndex = Math.min(
                this.selectedNameIndex,
                this.nameList.names.length - 2
              );
            }
          }
        }
        break;
    }
  }

  isNameSelected(index: number): boolean {
    return this.selectedNameIndex === index;
  }
}
