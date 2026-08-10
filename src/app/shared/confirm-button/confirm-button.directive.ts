import {
  Directive,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Input,
  OnDestroy,
  Output,
  Renderer2,
} from '@angular/core';

/**
 * Two-click confirmation for destructive buttons.
 * First click arms the button (label/class change); second click emits `confirmed`.
 * Clicking outside, Escape, or blur disarms without confirming.
 */
@Directive({
  selector: 'button[appConfirmButton]',
  standalone: true,
})
export class ConfirmButtonDirective implements OnDestroy {
  @Input() confirmLabel = 'Confirm';
  /** Optional CSS class applied while armed (in addition to `app-confirm-button--armed`). */
  @Input() armedClass = '';

  @Output() confirmed = new EventEmitter<MouseEvent>();
  @Output() armedChange = new EventEmitter<boolean>();

  @HostBinding('class.app-confirm-button--armed')
  armed = false;

  @HostBinding('attr.aria-pressed')
  get ariaPressed(): string {
    return this.armed ? 'true' : 'false';
  }

  private originalLabel: string | null = null;
  private originalTitle: string | null = null;
  private appliedArmedClass: string | null = null;

  constructor(
    private readonly el: ElementRef<HTMLButtonElement>,
    private readonly renderer: Renderer2
  ) {}

  ngOnDestroy(): void {
    this.disarm(false);
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.armed) {
      this.arm();
      return;
    }

    this.disarm(true);
    this.confirmed.emit(event);
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.armed) {
      return;
    }
    const target = event.target as Node | null;
    if (target && this.el.nativeElement.contains(target)) {
      return;
    }
    this.disarm(true);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.armed) {
      this.disarm(true);
    }
  }

  private arm(): void {
    const button = this.el.nativeElement;
    this.originalLabel = button.textContent;
    this.originalTitle = button.getAttribute('title');
    this.renderer.setProperty(button, 'textContent', this.confirmLabel);
    this.renderer.setAttribute(button, 'title', this.confirmLabel);
    if (this.armedClass) {
      this.renderer.addClass(button, this.armedClass);
      this.appliedArmedClass = this.armedClass;
    }
    this.armed = true;
    this.armedChange.emit(true);
  }

  private disarm(emit: boolean): void {
    if (!this.armed && this.originalLabel === null) {
      return;
    }
    const button = this.el.nativeElement;
    if (this.originalLabel !== null) {
      this.renderer.setProperty(button, 'textContent', this.originalLabel);
    }
    if (this.originalTitle !== null) {
      this.renderer.setAttribute(button, 'title', this.originalTitle);
    } else {
      this.renderer.removeAttribute(button, 'title');
    }
    if (this.appliedArmedClass) {
      this.renderer.removeClass(button, this.appliedArmedClass);
      this.appliedArmedClass = null;
    }
    this.originalLabel = null;
    this.originalTitle = null;
    const wasArmed = this.armed;
    this.armed = false;
    if (emit && wasArmed) {
      this.armedChange.emit(false);
    }
  }
}
