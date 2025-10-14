import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
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
  styleUrls: ['./multi-select-buttons.component.scss'],
  changeDetection: ChangeDetectionStrategy.Default
})
export class MultiSelectButtonsComponent {
  @Input() items: SelectableItem[] = [];
  @Input() selectedIds: string[] = [];
  @Input() label: string = '';

  @Output() selectionChange = new EventEmitter<string[]>();

  onItemToggle(itemId: string): void {
    // Create a local copy to ensure we're working with current state
    const currentSelection = this.selectedIds || [];
    const isSelected = currentSelection.includes(itemId);
    let newSelection: string[];

    if (isSelected) {
      newSelection = currentSelection.filter(id => id !== itemId);
    } else {
      newSelection = [...currentSelection, itemId];
    }

    this.selectionChange.emit(newSelection);
  }

  isItemSelected(itemId: string): boolean {
    return (this.selectedIds || []).includes(itemId);
  }
}
