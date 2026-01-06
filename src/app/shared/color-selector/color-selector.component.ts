import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-color-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './color-selector.component.html',
  styleUrls: ['./color-selector.component.scss']
})
export class ColorSelectorComponent implements OnInit, OnChanges {
  @Input() label: string = 'Color';
  @Input() color: string = '#848484';
  @Input() usedColors: string[] = [];
  @Output() colorChange = new EventEmitter<string>();

  filteredUsedColors: string[] = [];

  ngOnInit(): void {
    this.updateFilteredColors();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['color'] || changes['usedColors']) {
      this.updateFilteredColors();
    }
  }

  private updateFilteredColors(): void {
    // Remove current color from used colors list to avoid showing it twice
    this.filteredUsedColors = this.usedColors.filter(c => c && c !== this.color);
  }

  onColorChange(newColor: string): void {
    this.color = newColor;
    this.updateFilteredColors();
    this.colorChange.emit(newColor);
  }

  selectColor(color: string): void {
    this.onColorChange(color);
  }
}

