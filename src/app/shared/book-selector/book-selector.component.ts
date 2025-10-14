import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output, HostListener, ElementRef } from "@angular/core";
import { Book } from "@app/core";
import { trigger, transition, style, animate } from "@angular/animations";

@Component({
  selector: "app-book-selector",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./book-selector.component.html",
  styleUrls: ["./book-selector.component.scss"],
  animations: [
    trigger('dropdownAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-10px) scale(0.95)' }),
        animate('200ms cubic-bezier(0.4, 0.0, 0.2, 1)', style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
      ]),
      transition(':leave', [
        animate('150ms cubic-bezier(0.4, 0.0, 1, 1)', style({ opacity: 0, transform: 'translateY(-10px) scale(0.95)' }))
      ])
    ])
  ]
})
export class BookSelectorComponent {
  @Input() books: Book[] = [];
  @Input() selectedBook: string = ""; // book ID or empty string for "All Books"
  @Input() characterCounts: Map<string, number> = new Map(); // Map of book ID to character count
  @Output() bookChange = new EventEmitter<string>();

  isOpen = false;

  constructor(private elementRef: ElementRef) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Close dropdown if clicking outside
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
  }

  selectBook(bookId: string): void {
    this.selectedBook = bookId;
    this.bookChange.emit(bookId);
    this.isOpen = false;
  }

  getSelectedBookObject(): Book | null {
    if (!this.selectedBook) return null;
    return this.books.find(b => b.id === this.selectedBook) || null;
  }

  getBookGradient(book: Book): string {
    const color = book.color || "#3498db";
    return `linear-gradient(135deg, ${this.darkenColor(color, 0.3)} 0%, ${color} 100%)`;
  }

  getSpineGradient(book: Book): string {
    const color = book.color || "#3498db";
    const darkColor = this.darkenColor(color, 0.5);
    return `linear-gradient(90deg, ${darkColor} 0%, ${this.darkenColor(color, 0.2)} 50%, ${darkColor} 100%)`;
  }

  getBackGradient(book: Book): string {
    const color = book.color || "#3498db";
    return `linear-gradient(135deg, ${color} 0%, ${this.darkenColor(color, 0.3)} 100%)`;
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
    return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }

  getCharacterCount(bookId: string): number {
    return this.characterCounts.get(bookId) || 0;
  }
}
