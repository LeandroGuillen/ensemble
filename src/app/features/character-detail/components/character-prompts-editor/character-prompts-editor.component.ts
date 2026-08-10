import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CharacterPrompt } from '../../../../core/interfaces';

@Component({
  selector: 'app-character-prompts-editor',
  imports: [FormsModule],
  templateUrl: './character-prompts-editor.component.html',
  styleUrls: ['./character-prompts-editor.component.scss'],
})
export class CharacterPromptsEditorComponent implements OnChanges {
  @Input() prompts: CharacterPrompt[] = [];
  @Output() promptsChange = new EventEmitter<CharacterPrompt[]>();

  @Input() imageGenerationEnabled = false;
  @Input() generatingPromptIndex: number | null = null;
  @Input() thumbnailOutputDirectory: string | null = null;

  @Output() generateRequest = new EventEmitter<CharacterPrompt>();
  @Output() dirty = new EventEmitter<void>();

  selectedPromptIndex = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['prompts']) return;
    const curr = this.prompts;
    if (curr.length === 0) {
      this.selectedPromptIndex = -1;
    } else if (this.selectedPromptIndex < 0 || this.selectedPromptIndex >= curr.length) {
      this.selectedPromptIndex = 0;
    }
  }

  get selectedPrompt(): CharacterPrompt | null {
    if (this.selectedPromptIndex < 0 || this.selectedPromptIndex >= this.prompts.length) {
      return null;
    }
    return this.prompts[this.selectedPromptIndex];
  }

  get promptGenerateDisabled(): boolean {
    return (
      !this.imageGenerationEnabled ||
      this.generatingPromptIndex !== null ||
      !this.selectedPrompt ||
      !this.selectedPrompt.positive.trim()
    );
  }

  get promptGenerateTitle(): string {
    if (!this.imageGenerationEnabled) {
      return 'Enable image generation in AI Settings to generate from this prompt';
    }
    if (!this.selectedPrompt || !this.selectedPrompt.positive.trim()) {
      return 'Enter positive text to enable generation';
    }
    return this.thumbnailOutputDirectory
      ? `Generate with this prompt and save beside the current thumbnail (${this.thumbnailOutputDirectory})`
      : 'Generate with this prompt';
  }

  getPromptLabel(prompt: CharacterPrompt, index: number): string {
    return prompt.name?.trim() || `Prompt ${index + 1}`;
  }

  selectPrompt(index: number): void {
    if (index >= 0 && index < this.prompts.length) {
      this.selectedPromptIndex = index;
    }
  }

  addPrompt(): void {
    const next = [...this.prompts, { name: '', positive: '', negative: '' }];
    this.selectedPromptIndex = next.length - 1;
    this.emitPrompts(next);
  }

  removePrompt(index: number): void {
    if (index < 0 || index >= this.prompts.length) return;
    const next = this.prompts.filter((_, i) => i !== index);
    if (next.length === 0) {
      this.selectedPromptIndex = -1;
    } else if (this.selectedPromptIndex >= next.length) {
      this.selectedPromptIndex = next.length - 1;
    }
    this.emitPrompts(next);
  }

  setPromptAsDefault(index: number): void {
    if (index <= 0 || index >= this.prompts.length) return;
    const next = [...this.prompts];
    const [item] = next.splice(index, 1);
    next.unshift(item);
    this.selectedPromptIndex = this.selectedPromptIndex === index ? 0 : this.selectedPromptIndex;
    this.emitPrompts(next);
  }

  onPromptFieldChange(): void {
    this.dirty.emit();
    this.promptsChange.emit([...this.prompts]);
  }

  onGenerate(): void {
    const prompt = this.selectedPrompt;
    if (prompt && !this.promptGenerateDisabled) {
      this.generateRequest.emit(prompt);
    }
  }

  private emitPrompts(next: CharacterPrompt[]): void {
    this.prompts = next;
    this.promptsChange.emit(next);
    this.dirty.emit();
  }
}
