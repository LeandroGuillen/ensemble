import {
  AfterViewInit,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  ElementRef,
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
  /** Optional id of the element that describes the dialog (e.g. a confirmation message). */
  @Input() describedById = '';
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Input() showCloseButton = true;

  @Output() closed = new EventEmitter<void>();
  @Output() backdropClick = new EventEmitter<void>();

  @ViewChild(CdkTrapFocus) private trapFocus?: CdkTrapFocus;
  @ViewChild('dialogPanel') private dialogPanel?: ElementRef<HTMLElement>;

  readonly fallbackTitleId = `modal-frame-title-${++nextModalTitleId}`;
  private previouslyFocused: HTMLElement | null = null;

  get resolvedTitleId(): string {
    return this.labelledById || this.fallbackTitleId;
  }

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => this.focusInitialElement());
  }

  /**
   * Start focus where the user's work is, not on the header Close button:
   * an explicitly marked element, else the first field in the body, else the
   * first footer action (Cancel for confirmations), else the first tabbable.
   */
  private focusInitialElement(): void {
    const panel = this.dialogPanel?.nativeElement;
    if (!panel) {
      this.trapFocus?.focusTrap?.focusInitialElementWhenReady();
      return;
    }
    const usable = (el: Element | null): el is HTMLElement =>
      !!el && el instanceof HTMLElement && !el.hasAttribute('disabled') && el.getClientRects().length > 0;
    const pick = (selector: string): HTMLElement | null =>
      Array.from(panel.querySelectorAll(selector)).find(usable) as HTMLElement | undefined ?? null;
    const target =
      pick('.modal-body [cdkFocusInitial], .modal-body [autofocus]') ??
      pick('.modal-body input:not([type=hidden]), .modal-body textarea, .modal-body select, .modal-body [contenteditable=true]') ??
      pick('.modal-body .modal-actions button, .modal-body .form-actions button') ??
      pick('.modal-body button, .modal-body a[href], .modal-body [tabindex]:not([tabindex="-1"])');
    if (target) {
      target.focus();
    } else {
      this.trapFocus?.focusTrap?.focusInitialElementWhenReady();
    }
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
