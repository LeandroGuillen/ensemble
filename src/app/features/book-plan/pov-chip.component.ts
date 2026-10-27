import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { povColor } from '../../core/utils/book-plan.utils';

/** A PoV character's portrait, or a colored initial when there is none. */
@Component({
  selector: 'app-pov-chip',
  template: `
    @if (thumbnail) {
      <img [src]="thumbnail" [alt]="name" />
    } @else {
      <span class="pov-initial" [style.background]="color">{{ initial }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: var(--pov-chip-size, 18px);
      height: var(--pov-chip-size, 18px);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center 20%;
    }
    .pov-initial {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: #fff;
      font-size: calc(var(--pov-chip-size, 18px) * 0.56);
      font-weight: 700;
      line-height: 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PovChipComponent {
  @Input({ required: true }) characterId!: string;
  @Input() name = '';
  @Input() thumbnail: string | null = null;

  get color(): string {
    return povColor(this.characterId);
  }

  get initial(): string {
    return this.name.trim().charAt(0).toUpperCase() || '?';
  }
}
