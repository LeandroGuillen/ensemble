import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Pinboard } from '../../core/interfaces/pinboard.interface';
import { ModalFrameComponent } from '../modal-frame/modal-frame.component';

@Component({
  selector: 'app-pinboard-create-dialog',
  imports: [FormsModule, ModalFrameComponent],
  templateUrl: './pinboard-create-dialog.component.html',
  styleUrls: ['./pinboard-create-dialog.component.scss'],
})
export class PinboardCreateDialogComponent {
  @Input() visible = false;
  @Input() pinboards: Pinboard[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() create = new EventEmitter<{ name: string; duplicateFromId?: string }>();

  pinboardName = '';
  duplicateFromId: string | null = null;
  errorMessage = '';

  get availablePinboards(): Pinboard[] {
    return this.pinboards.filter((p) => p.id !== this.duplicateFromId);
  }

  onClose(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.reset();
  }

  onCreate(): void {
    this.errorMessage = '';

    if (!this.pinboardName.trim()) {
      this.errorMessage = 'Pinboard name is required';
      return;
    }

    if (this.pinboards.some((p) => p.name.toLowerCase() === this.pinboardName.trim().toLowerCase())) {
      this.errorMessage = `A pinboard named "${this.pinboardName.trim()}" already exists`;
      return;
    }

    this.create.emit({
      name: this.pinboardName.trim(),
      duplicateFromId: this.duplicateFromId || undefined,
    });
    this.reset();
  }

  private reset(): void {
    this.pinboardName = '';
    this.duplicateFromId = null;
    this.errorMessage = '';
  }
}
