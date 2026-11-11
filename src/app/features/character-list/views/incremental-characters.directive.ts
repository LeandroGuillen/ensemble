import { Directive, EmbeddedViewRef, Input, OnChanges, OnDestroy, TemplateRef, ViewContainerRef, inject } from '@angular/core';
import { Character } from '../../../core/interfaces';
import { CharacterRenderScheduler } from './character-render-scheduler.service';

interface CharacterContext {
  $implicit: Character;
  index: number;
}

/** Keep the ordinary card layout and drag/drop ancestry, but yield between cards.
 * Existing IDs retain their views on saves and sorting, including DOM scroll/focus.
 * The complete data array remains in the parent for search, grouping and drops.
 */
@Directive({ selector: '[appIncrementalCharacters]' })
export class IncrementalCharactersDirective implements OnChanges, OnDestroy {
  @Input() appIncrementalCharactersOf: Character[] = [];
  private readonly template = inject<TemplateRef<CharacterContext>>(TemplateRef);
  private readonly container = inject(ViewContainerRef);
  private readonly scheduler = inject(CharacterRenderScheduler);
  private readonly views = new Map<string, EmbeddedViewRef<CharacterContext>>();
  private cursor = 0;

  private readonly step = (): boolean => {
    const characters = this.appIncrementalCharactersOf;
    while (this.cursor < characters.length && this.views.has(characters[this.cursor].id)) this.cursor++;
    if (this.cursor >= characters.length) return false;
    const index = this.cursor++;
    const character = characters[index];
    let view = this.views.get(character.id);
    if (!view) {
      view = this.container.createEmbeddedView(this.template, { $implicit: character, index }, { index });
      this.views.set(character.id, view);
      view.detectChanges();
    }
    return this.cursor < characters.length;
  };

  ngOnChanges(): void {
    this.scheduler.cancel(this.step);
    const characters = this.appIncrementalCharactersOf;
    const ids = new Set(characters.map(character => character.id));
    for (const [id, view] of this.views) {
      if (!ids.has(id)) {
        this.container.remove(this.container.indexOf(view));
        this.views.delete(id);
      }
    }
    // Move retained views in their new order before scheduling missing ones.
    let position = 0;
    characters.forEach((character, index) => {
      const view = this.views.get(character.id);
      if (!view) return;
      view.context.$implicit = character;
      view.context.index = index;
      if (this.container.indexOf(view) !== position) this.container.move(view, position);
      position++;
    });
    this.cursor = 0;
    if (characters.length <= 24) {
      // Small collections appear immediately, within the budget shared by all groups.
      this.scheduler.renderSmall(this.step);
    } else {
      this.scheduler.enqueue(this.step);
    }
  }

  ngOnDestroy(): void {
    this.scheduler.cancel(this.step);
  }

  static ngTemplateContextGuard(_directive: IncrementalCharactersDirective, context: unknown): context is CharacterContext {
    return true;
  }
}
