import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Character } from '../../../../core/interfaces';
import { ColorSelectorComponent } from '../../../../shared/color-selector/color-selector.component';
import { ModalFrameComponent } from '../../../../shared/modal-frame/modal-frame.component';
import { ConnectionFormData } from '../../pinboard-connection-form';

@Component({
  selector: 'app-connection-edit-dialog',
  imports: [FormsModule, ColorSelectorComponent, ModalFrameComponent],
  templateUrl: './connection-edit-dialog.component.html',
  styleUrls: ['./connection-edit-dialog.component.scss'],
})
export class ConnectionEditDialogComponent {
  @Input() visible = false;
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() form: ConnectionFormData = {
    source: '',
    target: '',
    label: '',
    color: '#888888',
    labelColor: '#ffffff',
    arrowFrom: false,
    arrowTo: false,
  };
  @Input() sourceCharacter: Character | null = null;
  @Input() targetCharacter: Character | null = null;
  @Input() sourceThumbnail: string | null = null;
  @Input() targetThumbnail: string | null = null;
  @Input() usedConnectionColors: string[] = [];
  @Input() usedLabelColors: string[] = [];

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() save = new EventEmitter<ConnectionFormData>();
  @Output() delete = new EventEmitter<void>();

  get title(): string {
    return this.mode === 'edit' ? 'Edit Connection' : 'Create Connection';
  }

  onClose(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  onSubmit(): void {
    this.save.emit(this.form);
  }

  onDelete(): void {
    this.delete.emit();
  }
}
