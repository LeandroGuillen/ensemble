import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { Character } from '../../../../core/interfaces';
import { PromptFile, PromptSection } from '../../../../core/interfaces/prompt.interface';
import { PromptService } from '../../../../core/services/prompt.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { LoggingService } from '../../../../core/services/logging.service';
import { CommandPaletteService } from '../../../../shared/command-palette/command-palette.service';
import { promptVariants } from '../../../../core/utils/prompt-file.utils';
import { PromptImageComponent } from '../../../../shared/prompt-image/prompt-image.component';

/** A prompt variant the character page can copy or generate from. */
export interface CharacterPromptGenerateRequest {
  /** `<relativePath>#<section index>`; identifies the variant while it generates. */
  key: string;
  positive: string;
  negative: string;
}

interface LinkedVariant {
  key: string;
  label: string;
  section: PromptSection;
}

interface LinkedPromptView {
  file: PromptFile;
  variants: LinkedVariant[];
  images: string[];
}

/** Images shown per linked prompt file before the "+N" overflow. */
const MAX_IMAGES = 6;

/**
 * Prompts panel on the character page. Prompts live in the prompts folder and
 * own the link (`characters:` in the prompt file); this panel lists the files
 * linked to the character and creates or links new ones.
 */
@Component({
  selector: 'app-character-linked-prompts',
  imports: [AsyncPipe, PromptImageComponent],
  templateUrl: './character-linked-prompts.component.html',
  styleUrls: ['./character-linked-prompts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CharacterLinkedPromptsComponent implements OnInit, OnChanges {
  @Input({ required: true }) character!: Pick<Character, 'id' | 'name'>;
  @Input() imageGenerationEnabled = false;
  @Input() generatingKey: string | null = null;
  @Output() generateRequest = new EventEmitter<CharacterPromptGenerateRequest>();

  readonly maxImages = MAX_IMAGES;
  open = false;
  busy = false;

  private readonly characterId$ = new BehaviorSubject<string>('');
  linked$!: Observable<LinkedPromptView[]>;

  constructor(
    private promptService: PromptService,
    private notifications: NotificationService,
    private logger: LoggingService,
    private router: Router,
    private commandPalette: CommandPaletteService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const both$ = combineLatest([this.promptService.prompts$, this.characterId$]);
    this.linked$ = both$.pipe(
      map(([files, id]) =>
        this.promptService.promptsForCharacter(id, files).map((file) => ({
          file,
          variants: promptVariants(file).map((section) => ({
            key: `${file.relativePath}#${file.sections.indexOf(section)}`,
            label: section.name || 'Main',
            section,
          })),
          images: file.sections.flatMap((section) => section.images),
        }))
      )
    );
    void this.promptService.ensureLoaded();
  }

  ngOnChanges(): void {
    if (this.character?.id && this.character.id !== this.characterId$.value) {
      this.characterId$.next(this.character.id);
    }
  }

  onToggle(event: Event): void {
    this.open = (event.target as HTMLDetailsElement | null)?.open ?? false;
  }

  openPrompt(file: PromptFile): void {
    void this.router.navigate(['/prompts'], { queryParams: { path: file.relativePath } });
  }

  async copy(text: string | null): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.notifications.showSuccess('Prompt copied', 1500);
    } catch (error) {
      this.logger.error('Could not copy the prompt', error);
    }
  }

  generate(variant: LinkedVariant): void {
    this.generateRequest.emit({
      key: variant.key,
      positive: variant.section.prompt ?? '',
      negative: variant.section.negative ?? '',
    });
  }

  generateTitle(variant: LinkedVariant): string {
    if (!this.imageGenerationEnabled) return 'Enable image generation in Settings to generate from this prompt';
    if (!variant.section.prompt?.trim()) return 'This variant has no prompt text';
    return 'Generate a portrait with this prompt';
  }

  async createPrompt(): Promise<void> {
    await this.run(async () => {
      const file = await this.promptService.createPromptForCharacter(this.character);
      this.openPrompt(file);
    }, 'Could not create the prompt');
  }

  /** Searchable list of prompt files not yet linked to this character. */
  async linkExisting(): Promise<void> {
    const options = this.promptService
      .getPromptsSnapshot()
      .filter((file) => !file.characters.includes(this.character.id));
    if (options.length === 0) {
      this.notifications.showInfo('Every prompt is already linked to this character');
      return;
    }
    const picked = await this.commandPalette.pick(
      options.map((file) => ({
        id: file.relativePath,
        label: file.name,
        metadata: file.folder || undefined,
        icon: 'sparkles',
        keywords: [file.relativePath, ...file.tags],
        action: () => {},
      })),
      'Search prompts...'
    );
    const relativePath = picked?.id;
    if (!relativePath) return;
    await this.run(
      () => this.promptService.setCharacterLink(relativePath, this.character.id, true),
      'Could not link the prompt'
    );
  }

  async unlink(file: PromptFile): Promise<void> {
    await this.run(
      () => this.promptService.setCharacterLink(file.relativePath, this.character.id, false),
      'Could not unlink the prompt'
    );
  }

  private async run(action: () => Promise<void>, failure: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.cdr.markForCheck();
    try {
      await action();
    } catch (error) {
      this.logger.error(failure, error);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
