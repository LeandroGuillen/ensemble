import { ProjectReadOnlyDirective } from '../../../../shared/project-read-only.directive';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../../../../core/services/notification.service';
import { ImageWorkflow } from '../../../../core/interfaces';
import { ImageGenerationService } from '../../../../core/services/image-generation/image-generation.service';

@Component({
  selector: 'app-generate-portrait-dialog',
  imports: [ProjectReadOnlyDirective, FormsModule],
  templateUrl: './generate-portrait-dialog.component.html',
  styleUrls: ['./generate-portrait-dialog.component.scss'],
})
export class GeneratePortraitDialogComponent implements OnChanges {
  private readonly toasts = inject(NotificationService);
  @Input() visible = false;
  @Input() characterName = '';
  @Input() outputDirectory: string | null = null;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() portraitGenerated = new EventEmitter<string>();

  imageWorkflows: ImageWorkflow[] = [];
  selectedImageWorkflowId = '';
  positiveImagePrompt = '';
  negativeImagePrompt = '';
  isGeneratingPortrait = false;

  constructor(private imageGenerationService: ImageGenerationService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true) {
      void this.loadWorkflows();
    }
  }

  get selectedImageWorkflow(): ImageWorkflow | undefined {
    return this.imageWorkflows.find((workflow) => workflow.id === this.selectedImageWorkflowId);
  }

  onBackdropClick(): void {
    this.close();
  }

  onCloseClick(): void {
    this.close();
  }

  close(): void {
    if (this.isGeneratingPortrait) return;
    this.visible = false;
    this.visibleChange.emit(false);
    this.closed.emit();
  }

  async generatePortrait(): Promise<void> {
    if (!this.selectedImageWorkflowId || !this.positiveImagePrompt.trim()) return;
    const name = this.characterName.trim() || 'character';
    this.isGeneratingPortrait = true;
    try {
      const relativePath = await this.imageGenerationService.generateAndSave({
        workflowId: this.selectedImageWorkflowId,
        positivePrompt: this.positiveImagePrompt.trim(),
        negativePrompt: this.negativeImagePrompt.trim(),
        characterName: name,
        ...(this.outputDirectory ? { outputDirectory: this.outputDirectory } : {}),
      });
      this.portraitGenerated.emit(relativePath);
      this.visible = false;
      this.visibleChange.emit(false);
      this.closed.emit();
    } catch (error) {
      this.toasts.showError(error instanceof Error ? error.message : 'Failed to generate portrait');
    } finally {
      this.isGeneratingPortrait = false;
    }
  }

  private async loadWorkflows(): Promise<void> {
    try {
      this.imageWorkflows = await this.imageGenerationService.listWorkflows();
      const configured = this.imageGenerationService.getDefaultWorkflowId();
      this.selectedImageWorkflowId =
        (configured && this.imageWorkflows.some((workflow) => workflow.id === configured)
          ? configured
          : this.imageWorkflows[0]?.id) || '';
    } catch (error) {
      this.toasts.showError(error instanceof Error ? error.message : 'Failed to load image workflows');
      this.visible = false;
      this.visibleChange.emit(false);
      this.closed.emit();
    }
  }
}
