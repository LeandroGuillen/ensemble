import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { PromptService } from '../../core/services/prompt.service';

/**
 * Square thumbnail for an image attached to a prompt (a project-relative
 * path). Loads through PromptService's cache; shows a placeholder when the
 * file is missing.
 */
@Component({
  selector: 'app-prompt-image',
  template: `
    @if (url) {
      <img [src]="url" [alt]="path" loading="lazy" draggable="false" />
    } @else if (missing) {
      <span class="prompt-image-missing" [title]="'Missing image: ' + path">?</span>
    } @else {
      <span class="prompt-image-loading"></span>
    }
  `,
  styles: [`
    :host {
      display: block;
      overflow: hidden;
      border-radius: var(--radius-md);
      background: var(--color-bg-tertiary);
      border: 1px solid var(--color-border);
      box-sizing: border-box;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: var(--prompt-image-fit, cover);
    }
    .prompt-image-missing,
    .prompt-image-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptImageComponent implements OnChanges {
  @Input({ required: true }) path = '';

  url: string | null = null;
  missing = false;
  private requested = '';

  constructor(private promptService: PromptService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    if (this.path === this.requested) return;
    const path = (this.requested = this.path);
    this.url = null;
    this.missing = false;
    if (!path) {
      this.missing = true;
      return;
    }
    void this.promptService.loadImage(path).then((url) => {
      if (this.requested !== path) return;
      this.url = url;
      this.missing = !url;
      this.cdr.markForCheck();
    });
  }
}
