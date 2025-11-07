import { Component, Input, Output, EventEmitter } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { NameList } from "../../../../core/interfaces/backstage.interface";

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
  @Output() update = new EventEmitter<Partial<NameList>>();
  @Output() delete = new EventEmitter<void>();
  @Output() takeTheStage = new EventEmitter<string>();

  newNameInput = "";
  isCollapsed = false;

  onTitleChange(title: string): void {
    this.update.emit({ title });
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  onAddName(): void {
    if (this.newNameInput.trim()) {
      const names = [...this.nameList.names, this.newNameInput.trim()];
      this.update.emit({ names });
      this.newNameInput = "";
    }
  }

  onNameChange(index: number, newName: string): void {
    if (newName.trim()) {
      const names = [...this.nameList.names];
      names[index] = newName.trim();
      this.update.emit({ names });
    }
  }

  onRemoveName(index: number): void {
    const names = this.nameList.names.filter((_, i) => i !== index);
    this.update.emit({ names });
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.delete.emit();
  }

  onTakeTheStage(name: string, event: Event): void {
    event.stopPropagation();
    this.takeTheStage.emit(name);
  }
}
