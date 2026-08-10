import { Component, EventEmitter, Input, Output } from '@angular/core';

import { EMOJI_GROUPS, EmojiGroup } from './emoji-groups';

@Component({
  selector: 'app-emoji-picker',
  templateUrl: './emoji-picker.component.html',
  styleUrls: ['./emoji-picker.component.scss'],
})
export class EmojiPickerComponent {
  @Input() selectedEmoji = '';
  @Input() groups: EmojiGroup[] = EMOJI_GROUPS;
  @Input() showClear = false;
  @Input() clearLabel = 'Clear icon';
  /** When set, adds a CSS class on the root for dropdown vs inline layouts. */
  @Input() variant: 'inline' | 'dropdown' = 'inline';

  @Output() emojiSelect = new EventEmitter<string>();
  @Output() clear = new EventEmitter<void>();

  onEmojiClick(emoji: string, event: Event): void {
    event.stopPropagation();
    this.emojiSelect.emit(emoji);
  }

  onClearClick(event: Event): void {
    event.stopPropagation();
    this.clear.emit();
  }
}
