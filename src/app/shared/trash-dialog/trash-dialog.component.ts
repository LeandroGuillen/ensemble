import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface DeletedCharacter {
  folderName: string;
  name: string;
  deletedAt: Date;
}

@Component({
  selector: 'app-trash-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trash-dialog.component.html',
  styleUrls: ['./trash-dialog.component.scss']
})
export class TrashDialogComponent {
  @Input() visible = false;
  @Input() deletedCharacters: DeletedCharacter[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() restore = new EventEmitter<string>();
  @Output() deletePermanently = new EventEmitter<string>();

  onClose(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  onRestore(folderName: string): void {
    this.restore.emit(folderName);
  }

  onDeletePermanently(folderName: string): void {
    this.deletePermanently.emit(folderName);
  }

  onOverlayClick(): void {
    this.onClose();
  }

  onDialogClick(event: Event): void {
    event.stopPropagation();
  }

  formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

