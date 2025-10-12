import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SelectableItem {
  id: string;
  name: string;
  color: string;
}

@Component({
  selector: 'app-multi-select-buttons',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './multi-select-buttons.component.html',
  styleUrls: ['./multi-select-buttons.component.scss']
})
export class MultiSelectButtonsComponent {
  @Input() items: SelectableItem[] = [];
  @Input() selectedIds: string[] = [];
  @Input() label: string = '';

  @Output() selectionChange = new EventEmitter<string[]>();

  onItemToggle(itemId: string): void {
    const isSelected = this.selectedIds.includes(itemId);
    let newSelection: string[];

    if (isSelected) {
      newSelection = this.selectedIds.filter(id => id !== itemId);
    } else {
      newSelection = [...this.selectedIds, itemId];
    }

    this.selectionChange.emit(newSelection);
  }

  isItemSelected(itemId: string): boolean {
    return this.selectedIds.includes(itemId);
  }
}
