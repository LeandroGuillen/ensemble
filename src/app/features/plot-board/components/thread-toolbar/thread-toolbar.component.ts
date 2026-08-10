import { Component, EventEmitter, Input, Output, inject } from '@angular/core';

import { PlotThread } from '../../../../core/interfaces/plot-board.interface';
import { ColorSwatchPickerComponent } from '../../../../shared/color-swatch-picker/color-swatch-picker.component';
import { ThreadToolbarService } from './thread-toolbar.service';

@Component({
  selector: 'app-thread-toolbar',
  imports: [ColorSwatchPickerComponent],
  templateUrl: './thread-toolbar.component.html',
  styleUrls: ['./thread-toolbar.component.scss'],
})
export class ThreadToolbarComponent {
  readonly toolbar = inject(ThreadToolbarService);

  @Input({ required: true }) threads: PlotThread[] = [];
  @Input() paletteColors: string[] = [];
  @Input() confirmDeleteThreadId: string | null = null;
  @Input() showThreadColorPicker: string | null = null;

  @Output() toggleColorPicker = new EventEmitter<string>();
  @Output() selectColor = new EventEmitter<{ threadId: string; color: string }>();
  @Output() clearColor = new EventEmitter<string>();
  @Output() addCharacter = new EventEmitter<string>();
  @Output() requestDelete = new EventEmitter<string>();
  @Output() confirmDelete = new EventEmitter<string>();

  onToolbarMouseEnter(threadId: string): void {
    this.toolbar.onToolbarMouseEnter(threadId);
  }

  onToolbarMouseLeave(threadId: string): void {
    this.toolbar.onToolbarMouseLeave(threadId, this.confirmDeleteThreadId, this.showThreadColorPicker);
  }

  isVisible(threadId: string): boolean {
    return this.toolbar.isVisible(threadId, this.confirmDeleteThreadId, this.showThreadColorPicker);
  }

  onToggleColorPicker(threadId: string, event: Event): void {
    event.stopPropagation();
    this.toggleColorPicker.emit(threadId);
  }

  onColorSelected(threadId: string, color: string): void {
    this.selectColor.emit({ threadId, color });
  }

  onClearColor(threadId: string, event: Event): void {
    event.stopPropagation();
    this.clearColor.emit(threadId);
  }

  onAddCharacter(threadId: string, event: Event): void {
    event.stopPropagation();
    this.addCharacter.emit(threadId);
  }

  onRequestDelete(threadId: string, event: Event): void {
    event.stopPropagation();
    this.requestDelete.emit(threadId);
  }

  onConfirmDelete(threadId: string, event: Event): void {
    event.stopPropagation();
    this.confirmDelete.emit(threadId);
  }
}
