import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ToggleOption {
  id: string;
  name: string;
  tooltip?: string;
}

@Component({
  selector: 'app-category-toggle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-toggle.component.html',
  styleUrls: ['./category-toggle.component.scss']
})
export class CategoryToggleComponent {
  @Input() options: ToggleOption[] = [];
  @Input() selectedValue: string = '';
  @Input() emptyLabel: string = 'All'; // "All" or "None" depending on context
  @Input() error: boolean = false;

  @Output() valueChange = new EventEmitter<string>();

  onOptionClick(value: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.valueChange.emit(value);
  }
}
