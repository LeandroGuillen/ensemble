import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { Book } from "@app/core";
import { LoggingService } from "@app/core/services/logging.service";

@Component({
  selector: "app-book-item",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./book-item.component.html",
  styleUrls: ["./book-item.component.scss"],
})
export class BookItemComponent {
  @Input() book!: Book;
  @Input() isSelected = false;
  @Input() isDragging = false;
  @Input() dragIndex!: number;
  @Output() bookClick = new EventEmitter<Book>();
  @Output() dragStart = new EventEmitter<DragEvent>();
  @Output() dragEndEvent = new EventEmitter<void>();

  constructor(private logger: LoggingService) {}

  onBookClick(): void {
    // Prevent click during drag
    if (!this.isDragging) {
      this.bookClick.emit(this.book);
    }
  }

  getBookTitle(): string {
    return this.book.name || "Untitled";
  }

  getBookColor(): string {
    return this.book.color || "#3498db";
  }

  getStatusLabel(): string {
    if (!this.book.status) return "";
    const statusMap: { [key: string]: string } = {
      draft: "Draft",
      "in-progress": "In Progress",
      complete: "Complete",
      published: "Published",
      "on-hold": "On Hold",
    };
    return statusMap[this.book.status] || this.book.status;
  }

  getBookGradient(): string {
    const color = this.getBookColor();
    return `linear-gradient(135deg, ${this.darkenColor(
      color,
      0.3
    )} 0%, ${color} 100%)`;
  }

  getSpineGradient(): string {
    const color = this.getBookColor();
    const darkColor = this.darkenColor(color, 0.5);
    return `linear-gradient(90deg, ${darkColor} 0%, ${this.darkenColor(
      color,
      0.2
    )} 50%, ${darkColor} 100%)`;
  }

  getBackGradient(): string {
    const color = this.getBookColor();
    return `linear-gradient(135deg, ${color} 0%, ${this.darkenColor(
      color,
      0.3
    )} 100%)`;
  }

  private darkenColor(hex: string, amount: number): string {
    // Remove # if present
    hex = hex.replace("#", "");

    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Darken by reducing each component
    const newR = Math.max(0, Math.floor(r * (1 - amount)));
    const newG = Math.max(0, Math.floor(g * (1 - amount)));
    const newB = Math.max(0, Math.floor(b * (1 - amount)));

    // Convert back to hex
    return `#${newR.toString(16).padStart(2, "0")}${newG
      .toString(16)
      .padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }
  onDragStart(event: DragEvent): void {
    this.logger.log("Book drag start triggered!", this.book.name);
    this.dragStart.emit(event);
  }

  onDragEnd(): void {
    this.dragEndEvent.emit();
  }
}
