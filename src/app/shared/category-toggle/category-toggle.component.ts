import { Component, Input, Output, EventEmitter } from '@angular/core';


export interface ToggleOption {
  id: string;
  name: string;
  tooltip?: string;
  color?: string;
}

@Component({
    selector: 'app-category-toggle',
    imports: [],
    templateUrl: './category-toggle.component.html',
    styleUrls: ['./category-toggle.component.scss']
})
export class CategoryToggleComponent {
  @Input() options: ToggleOption[] = [];
  @Input() selectedValue: string = '';
  @Input() emptyLabel: string = 'All'; // "All" or "None" depending on context
  @Input() error: boolean = false;
  /** Optional value to mark with an outline independently of the active selection. */
  @Input() outlinedValue: string | null = null;
  @Input() outlinedTooltip: string = '';

  @Output() valueChange = new EventEmitter<string>();

  onOptionClick(value: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.valueChange.emit(value);
  }

  getOptionTitle(option: ToggleOption): string {
    return this.outlinedValue === option.id && this.outlinedTooltip
      ? this.outlinedTooltip
      : option.tooltip || option.name;
  }
}
