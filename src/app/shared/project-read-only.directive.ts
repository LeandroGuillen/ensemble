import { Directive, DoCheck, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { READ_ONLY_PROJECT_MESSAGE, ProjectWriteProtectionService } from '../core/services/project-write-protection.service';

/** Disable an editing control without disabling navigation or filtering nearby. */
@Directive({ selector: '[appProjectReadOnly]' })
export class ProjectReadOnlyDirective implements DoCheck {
  private readonly protection = inject(ProjectWriteProtectionService);
  private readonly control = inject(NgControl, { optional: true, self: true });
  private readonly element = inject(ElementRef<HTMLElement>);
  private protected = false;
  private previouslyDisabled = false;
  private previousTitle: string | null = null;

  ngDoCheck(): void {
    const readOnly = !!this.protection.readOnlyPath;
    if (!readOnly && !this.protected) return;
    // Keep the form's value/validation intact; only its editing surface changes.
    this.control?.valueAccessor?.setDisabledState?.(readOnly || !!this.control.disabled);
    const element = this.element.nativeElement;
    if (readOnly && !this.protected) this.previousTitle = element.getAttribute('title');
    if (readOnly) element.setAttribute('title', READ_ONLY_PROJECT_MESSAGE);
    else if (this.previousTitle === null) element.removeAttribute('title');
    else element.setAttribute('title', this.previousTitle);
    if (readOnly && !this.protected && 'disabled' in element) {
      this.previouslyDisabled = (element as HTMLInputElement).disabled;
    }
    if ('disabled' in element) {
      if (readOnly) (element as HTMLInputElement).disabled = true;
      else (element as HTMLInputElement).disabled = this.control ? !!this.control.disabled : this.previouslyDisabled;
    } else if (!this.control) {
      element.inert = readOnly;
    }
    this.protected = readOnly;
  }
}
