import { Component, Input, Output, EventEmitter } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { CharacterConcept } from "../../../../core/interfaces/backstage.interface";

@Component({
  selector: "app-concept-card",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./concept-card.component.html",
  styleUrls: ["./concept-card.component.scss"],
})
export class ConceptCardComponent {
  @Input() concept!: CharacterConcept;
  @Input() index!: number;
  @Input() isFocused = false;
  @Input() isDimmed = false;
  @Input() isSelected = false;
  @Output() update = new EventEmitter<Partial<CharacterConcept>>();
  @Output() delete = new EventEmitter<void>();
  @Output() takeTheStage = new EventEmitter<void>();
  @Output() focus = new EventEmitter<void>();

  onTitleChange(title: string): void {
    this.update.emit({ title });
  }

  onNotesChange(notes: string): void {
    this.update.emit({ notes });
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.delete.emit();
  }

  onTakeTheStage(event: Event): void {
    event.stopPropagation();
    this.takeTheStage.emit();
  }

  onFocus(): void {
    this.focus.emit();
  }
}
