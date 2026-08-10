import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ModalFrameComponent } from '../modal-frame/modal-frame.component';

@Component({
  selector: 'app-confirmation-dialog',
  imports: [ModalFrameComponent],
  templateUrl: './confirmation-dialog.component.html',
  styleUrls: ['./confirmation-dialog.component.scss'],
})
export class ConfirmationDialogComponent {
  @Input() visible = false;
  @Input() title = 'Confirm';
  @Input() message = 'Are you sure?';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';
  @Input() confirmButtonClass = 'btn-primary';
  @Input() danger = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onConfirm(): void {
    this.confirm.emit();
    this.close();
  }

  onCancel(): void {
    this.cancel.emit();
    this.close();
  }

  onClose(): void {
    this.cancel.emit();
    this.close();
  }

  private close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }
}
