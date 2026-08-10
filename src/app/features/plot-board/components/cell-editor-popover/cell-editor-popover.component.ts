import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  Output,
  ViewChild,
  afterNextRender,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ColorSwatchPickerComponent } from '../../../../shared/color-swatch-picker/color-swatch-picker.component';
import { EmojiPickerComponent } from '../../../../shared/emoji-picker/emoji-picker.component';

@Component({
  selector: 'app-cell-editor-popover',
  imports: [FormsModule, EmojiPickerComponent, ColorSwatchPickerComponent],
  templateUrl: './cell-editor-popover.component.html',
  styleUrls: ['./cell-editor-popover.component.scss'],
})
export class CellEditorPopoverComponent implements AfterViewInit {
  private static readonly TEXTAREA_MAX_REM = 15;

  @Input() value = '';
  @Input() icon = '';
  @Input() color = '';
  @Input() paletteColors: string[] = [];
  @Input() saveShortcutModifierLabel = 'Ctrl';
  @Input() showEmojiPicker = false;
  @Input() confirmDelete = false;
  @Input() canDelete = false;

  @Output() valueChange = new EventEmitter<string>();
  @Output() iconChange = new EventEmitter<string>();
  @Output() colorChange = new EventEmitter<string>();
  @Output() showEmojiPickerChange = new EventEmitter<boolean>();
  @Output() confirmDeleteChange = new EventEmitter<boolean>();
  @Output() save = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() requestDelete = new EventEmitter<void>();
  @Output() confirmDeleteAction = new EventEmitter<void>();

  @ViewChild('cellEditTextarea') cellEditTextarea?: ElementRef<HTMLTextAreaElement>;

  constructor(private injector: Injector) {}

  ngAfterViewInit(): void {
    afterNextRender(() => {
      const ta =
        this.cellEditTextarea?.nativeElement ??
        (document.querySelector('.cell-edit-textarea') as HTMLTextAreaElement | null);
      if (ta) {
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
        requestAnimationFrame(() => this.layoutTextarea());
      }
    }, { injector: this.injector });
  }

  layoutTextarea(): void {
    const ta = this.cellEditTextarea?.nativeElement;
    if (!ta) return;
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPx = CellEditorPopoverComponent.TEXTAREA_MAX_REM * rootPx;
    ta.style.height = '0';
    ta.style.height = `${Math.min(ta.scrollHeight, maxPx)}px`;
  }

  onTextareaInput(): void {
    this.layoutTextarea();
  }

  onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    this.save.emit();
  }

  onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cancel.emit();
  }

  toggleEmojiPicker(event: Event): void {
    event.stopPropagation();
    this.showEmojiPicker = !this.showEmojiPicker;
    this.showEmojiPickerChange.emit(this.showEmojiPicker);
  }

  onEmojiSelect(emoji: string): void {
    this.icon = this.icon === emoji ? '' : emoji;
    this.iconChange.emit(this.icon);
    this.showEmojiPicker = false;
    this.showEmojiPickerChange.emit(false);
  }

  onColorSelect(color: string): void {
    this.color = color;
    this.colorChange.emit(color);
  }

  clearIcon(event: Event): void {
    event.stopPropagation();
    this.icon = '';
    this.iconChange.emit('');
  }

  onRequestDelete(event: Event): void {
    event.stopPropagation();
    this.requestDelete.emit();
  }

  onConfirmDelete(event: Event): void {
    event.stopPropagation();
    this.confirmDeleteAction.emit();
  }

  onSave(event: Event): void {
    event.stopPropagation();
    this.save.emit();
  }

  get saveTitle(): string {
    return this.saveShortcutModifierLabel === '⌘' ? 'Save (⌘ Enter)' : 'Save (Ctrl+Enter)';
  }
}
