import { IncrementalCharactersDirective } from '../incremental-characters.directive';
import { ProjectReadOnlyDirective } from '../../../../shared/project-read-only.directive';
import { ExcerptPipe } from "../../../../shared/pipes/excerpt.pipe";
import { Component, DestroyRef, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { PromptFile } from '../../../../core/interfaces/prompt.interface';
import { PromptService } from '../../../../core/services/prompt.service';
import { LoggingService } from '../../../../core/services/logging.service';
import { promptVariants } from '../../../../core/utils/prompt-file.utils';
import { PromptImageComponent } from '../../../../shared/prompt-image/prompt-image.component';

import { DragDropModule } from '@angular/cdk/drag-drop';
import { Character, Tag, Category } from '../../../../core/interfaces';
import { MetadataHelperService } from '../../../../core/services/metadata-helper.service';
import { resolveEffectiveCategory } from '../../../../core/utils/character-category.utils';
import { getCharacterDisplayName } from '../../../../core/utils/character-display.utils';
import { FadeOverflowDirective } from '../../../../shared/fade-overflow.directive';

/** Prompt images shown per character row in the Prompts view. */
const PROMPT_IMAGES_PER_ROW = 4;

@Component({
    selector: 'app-character-list-view',
    imports: [IncrementalCharactersDirective, ProjectReadOnlyDirective, DragDropModule, FadeOverflowDirective, ExcerptPipe, PromptImageComponent],
    templateUrl: './character-list-view.component.html',
    styleUrls: ['./character-list-view.component.scss']
})
export class CharacterListViewComponent implements OnInit {
  readonly getCharacterDisplayName = getCharacterDisplayName;
  @Input() characters: Character[] = [];
  @Input() categories: Category[] = [];
  @Input() tags: Tag[] = [];
  @Input() columns: 1 | 2 = 2;
  /** Flat keyboard-nav index of the highlighted occurrence (-1 = none). */
  @Input() selectedNavIndex = -1;
  /** Global nav-index offset for the first card in this view instance. */
  @Input() navIndexOffset = 0;
  @Input() dndEnabled = false;
  @Input() selectedCharacterIds: string[] = [];
  @Input() thumbnailDataUrls: Map<string, string> = new Map();
  /** When set, category labels use the book-specific override if present. */
  @Input() categoryContextBookId = '';
  /** Character IDs that are PoV under the current book filter context. */
  @Input() povCharacterIds: Set<string> = new Set();
  /** Color for the PoV badge pill. */
  @Input() povBadgeColor = 'var(--color-accent-primary)';

  /** Prompts view: show each character's linked prompt files and their images. */
  @Input() showPrompts = false;

  @Output() characterClick = new EventEmitter<Character>();
  @Output() characterDuplicate = new EventEmitter<Character>();
  @Output() characterSelectionToggle = new EventEmitter<string>();
  @Output() dragStarted = new EventEmitter<void>();
  @Output() dragEnded = new EventEmitter<void>();
  private dragInProgress = false;

  private promptsByCharacter = new Map<string, PromptFile[]>();
  creatingPromptFor: string | null = null;

  constructor(
    public metadataHelper: MetadataHelperService,
    private promptService: PromptService,
    private router: Router,
    private logger: LoggingService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.promptService.prompts$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((files) => {
      const byCharacter = new Map<string, PromptFile[]>();
      for (const file of files) {
        for (const id of file.characters) {
          const list = byCharacter.get(id);
          if (list) list.push(file);
          else byCharacter.set(id, [file]);
        }
      }
      this.promptsByCharacter = byCharacter;
    });
  }

  promptsFor(character: Character): PromptFile[] {
    return this.promptsByCharacter.get(character.id) ?? [];
  }

  promptImagesFor(character: Character): string[] {
    return this.promptsFor(character)
      .flatMap((file) => file.sections.flatMap((section) => section.images))
      .slice(0, PROMPT_IMAGES_PER_ROW);
  }

  variantCount(file: PromptFile): number {
    return promptVariants(file).length;
  }

  openPrompt(file: PromptFile, event: Event): void {
    event.stopPropagation();
    void this.router.navigate(['/prompts'], { queryParams: { path: file.relativePath } });
  }

  async newPrompt(character: Character, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.creatingPromptFor) return;
    this.creatingPromptFor = character.id;
    try {
      const file = await this.promptService.createPromptForCharacter(character);
      await this.router.navigate(['/prompts'], { queryParams: { path: file.relativePath } });
    } catch (error) {
      this.logger.error('Could not create the prompt', error);
    } finally {
      this.creatingPromptFor = null;
    }
  }

  /** Highlight by occurrence in the flattened nav list, not by character id. */
  isOccurrenceSelected(localIndex: number): boolean {
    return (
      this.selectedNavIndex >= 0 &&
      this.selectedNavIndex === this.navIndexOffset + localIndex
    );
  }

  getCharacterLink(character: Character): string[] {
    return ['/character', encodeURIComponent(character.id)];
  }

  getDisplayCategoryId(character: Character): string {
    return resolveEffectiveCategory(character, this.categoryContextBookId);
  }

  isPov(character: Character): boolean {
    return this.povCharacterIds.has(character.id);
  }

  getCategoryName(categoryId: string): string {
    return categoryId ? this.metadataHelper.getCategoryName(categoryId) : 'No category';
  }

  getCategoryColor(categoryId: string): string {
    return this.metadataHelper.getCategoryColor(categoryId);
  }

  getCharacterTagsInOrder(character: Character): Tag[] {
    return this.tags.filter((tag) => character.tags.includes(tag.id));
  }

  getCharacterThumbnailDataUrl(character: Character): string | null {
    return this.thumbnailDataUrls.get(character.id) || null;
  }

  isCharacterSelected(characterId: string): boolean {
    return this.selectedCharacterIds.includes(characterId);
  }

  /** Enter/Space open the card only when the card itself has focus, not one of its buttons. */
  onCardKeydown(event: Event, character: Character): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    this.onCharacterClick(character);
  }

  onCharacterClick(character: Character): void {
    if (this.dragInProgress) {
      return;
    }
    this.characterClick.emit(character);
  }

  onCharacterSelectionToggle(characterId: string): void {
    this.characterSelectionToggle.emit(characterId);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
    }
  }

  onCharacterDuplicate(character: Character, event: Event): void {
    event.stopPropagation();
    if (this.dragInProgress) return;
    this.characterDuplicate.emit(character);
  }

  onDragStarted(): void {
    this.dragInProgress = true;
    this.dragStarted.emit();
  }

  onDragEnded(): void {
    setTimeout(() => {
      this.dragInProgress = false;
      this.dragEnded.emit();
    }, 0);
  }

  getPlaceholderColor(character: Character): string {
    if (character.tags && character.tags.length > 0) {
      const firstTagId = character.tags[0];
      const tag = this.tags.find(t => t.id === firstTagId);
      if (tag?.color) {
        return tag.color;
      }
    }
    return '#6b7280'; // Default gray
  }
}
