import {
  AfterViewInit,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { CdkTrapFocus } from '@angular/cdk/a11y';

let nextModalTitleId = 0;

@Component({
  selector: 'app-modal-frame',
  imports: [CdkTrapFocus, NgClass],
  templateUrl: './modal-frame.component.html',
  styleUrls: ['./modal-frame.component.scss'],
})
export class ModalFrameComponent implements AfterViewInit, OnDestroy {
  @Input() title = '';
  @Input() labelledById = '';
  @Input() dialogClass = '';
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Input() showCloseButton = true;

  @Output() closed = new EventEmitter<void>();
  @Output() backdropClick = new EventEmitter<void>();

  @ViewChild(CdkTrapFocus) private trapFocus?: CdkTrapFocus;

  readonly fallbackTitleId = `modal-frame-title-${++nextModalTitleId}`;
  private previouslyFocused: HTMLElement | null = null;

  get resolvedTitleId(): string {
    return this.labelledById || this.fallbackTitleId;
  }

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => this.trapFocus?.focusTrap?.focusInitialElementWhenReady());
  }

  ngOnDestroy(): void {
    this.previouslyFocused?.focus?.();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.closeOnEscape || event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  onBackdropClick(): void {
    this.backdropClick.emit();
    if (this.closeOnBackdrop) {
      this.close();
    }
  }

  onDialogClick(event: Event): void {
    event.stopPropagation();
  }

  close(): void {
    this.closed.emit();
  }
}
