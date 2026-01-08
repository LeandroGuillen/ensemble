import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pinboard-rename-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pinboard-rename-dialog.component.html',
  styleUrls: ['./pinboard-rename-dialog.component.scss']
})
export class PinboardRenameDialogComponent implements OnChanges {
  @Input() visible = false;
  @Input() currentName = '';
  @Input() allPinboardNames: string[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() rename = new EventEmitter<string>();

  pinboardName = '';
  errorMessage = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && changes['visible'].currentValue) {
      this.pinboardName = this.currentName;
      this.errorMessage = '';
    }
    if (changes['currentName'] && this.visible) {
      this.pinboardName = this.currentName;
      this.errorMessage = '';
    }
  }

  onClose(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.reset();
  }

  onRename(): void {
    this.errorMessage = '';

    if (!this.pinboardName.trim()) {
      this.errorMessage = 'Pinboard name is required';
      return;
    }

    if (this.pinboardName.trim() === this.currentName) {
      // No change, just close
      this.onClose();
      return;
    }

    // Check for duplicate name (excluding current)
    const otherNames = this.allPinboardNames.filter(n => n !== this.currentName);
    if (otherNames.some(n => n.toLowerCase() === this.pinboardName.trim().toLowerCase())) {
      this.errorMessage = `A pinboard named "${this.pinboardName.trim()}" already exists`;
      return;
    }

    this.rename.emit(this.pinboardName.trim());
    this.reset();
  }

  private reset(): void {
    this.pinboardName = '';
    this.errorMessage = '';
  }

  onOverlayClick(): void {
    this.onClose();
  }

  onDialogClick(event: Event): void {
    event.stopPropagation();
  }
}

