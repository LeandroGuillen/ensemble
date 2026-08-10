import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-color-swatch-picker',
  templateUrl: './color-swatch-picker.component.html',
  styleUrls: ['./color-swatch-picker.component.scss'],
})
export class ColorSwatchPickerComponent {
  @Input() colors: string[] = [];
  @Input() selectedColor = '';
  /** Toggle selection off when clicking the active swatch (plot-board behavior). */
  @Input() toggleOnReselect = true;

  @Output() colorSelect = new EventEmitter<string>();

  onSwatchClick(color: string, event: Event): void {
    event.stopPropagation();
    if (this.toggleOnReselect && this.selectedColor === color) {
      this.colorSelect.emit('');
    } else {
      this.colorSelect.emit(color);
    }
  }
}
