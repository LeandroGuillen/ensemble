import { ProjectReadOnlyDirective } from '../../../../shared/project-read-only.directive';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalFrameComponent } from '../../../../shared/modal-frame/modal-frame.component';
import { sanitizePromptPath } from '../../../../core/services/prompt.service';

/**
 * Asks for a prompt path relative to the prompts folder: a name, optionally
 * with folders (`places/Academia`). Used for New prompt and Rename / Move.
 */
@Component({
  selector: 'app-prompt-path-dialog',
  imports: [ProjectReadOnlyDirective, FormsModule, ModalFrameComponent],
  templateUrl: './prompt-path-dialog.component.html',
  styleUrls: ['./prompt-path-dialog.component.scss'],
})
export class PromptPathDialogComponent implements OnChanges {
  @Input() visible = false;
  @Input() title = 'New prompt';
  @Input() confirmText = 'Create';
  @Input() initialValue = '';
  @Input() folders: string[] = [];
  @Input() promptsFolderLabel = 'prompts';
  @Output() submitted = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  value = '';
  error = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue || (changes['initialValue'] && this.visible)) {
      this.value = this.initialValue;
      this.error = '';
    }
  }

  get preview(): string {
    const clean = sanitizePromptPath(this.value);
    return clean ? `${this.promptsFolderLabel}/${clean}.md` : '';
  }

  submit(): void {
    const clean = sanitizePromptPath(this.value);
    if (!clean) {
      this.error = 'Enter a name';
      return;
    }
    this.submitted.emit(clean);
  }

  close(): void {
    this.closed.emit();
  }
}
