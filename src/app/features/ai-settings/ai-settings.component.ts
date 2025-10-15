import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { AiSettings } from '../../core/interfaces/project.interface';
import { AiService, AiTestConnectionResult } from '../../core/services/ai.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

@Component({
  selector: 'app-ai-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, PageHeaderComponent],
  templateUrl: './ai-settings.component.html',
  styleUrls: ['./ai-settings.component.scss'],
})
export class AiSettingsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  aiForm: FormGroup;
  saving = false;
  testing = false;
  testResult: AiTestConnectionResult | null = null;
  error: string | null = null;
  successMessage: string | null = null;

  providers = [
    { id: 'ollama', name: 'Ollama (Local)', description: 'Free local AI server' },
    { id: 'lm-studio', name: 'LM Studio (Local)', description: 'Local AI with GUI' },
    { id: 'openai', name: 'OpenAI (Cloud)', description: 'Requires API key', disabled: true },
    { id: 'anthropic', name: 'Anthropic (Cloud)', description: 'Requires API key', disabled: true },
  ];

  constructor(private fb: FormBuilder, private aiService: AiService) {
    this.aiForm = this.createForm();
  }

  ngOnInit(): void {
    this.loadSettings();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private createForm(): FormGroup {
    return this.fb.group({
      enabled: [false],
      provider: ['ollama', Validators.required],
      localServerUrl: ['http://localhost:11434', Validators.required],
      modelName: ['', Validators.required],
      apiKey: [''],
      temperature: [0.7, [Validators.required, Validators.min(0), Validators.max(1)]],
      maxTokens: [100, [Validators.required, Validators.min(1), Validators.max(2000)]],
    });
  }

  private loadSettings(): void {
    this.aiService
      .getAiSettings()
      .pipe(takeUntil(this.destroy$))
      .subscribe((settings) => {
        if (settings) {
          this.aiForm.patchValue(settings);
          this.onProviderChange(); // Update URL placeholder based on provider
        }
      });
  }

  onProviderChange(): void {
    const provider = this.aiForm.get('provider')?.value;
    const currentUrl = this.aiForm.get('localServerUrl')?.value;
    const currentModel = this.aiForm.get('modelName')?.value;

    // Only set defaults if URL is empty or from another provider
    if (provider === 'ollama') {
      // Set default URL only if empty or from LM Studio
      if (!currentUrl || currentUrl === 'http://localhost:1234') {
        this.aiForm.patchValue({
          localServerUrl: 'http://localhost:11434',
        });
      }
      // Clear modelName only if it's the LM Studio default
      if (currentModel === 'local-model') {
        this.aiForm.patchValue({
          modelName: '',
        });
      }
    } else if (provider === 'lm-studio') {
      // Set default URL only if empty or from Ollama
      if (!currentUrl || currentUrl === 'http://localhost:11434') {
        this.aiForm.patchValue({
          localServerUrl: 'http://localhost:1234',
        });
      }
      // Set default modelName only if empty
      if (!currentModel) {
        this.aiForm.patchValue({
          modelName: 'local-model',
        });
      }
    }
  }

  async testConnection(): Promise<void> {
    // Save settings first before testing
    await this.saveSettings(false);

    this.testing = true;
    this.testResult = null;
    this.error = null;

    try {
      const result = await this.aiService.testConnection();
      this.testResult = result;

      if (!result.success) {
        this.error = result.error || 'Connection test failed';
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error during test';
      this.testResult = { success: false, error: this.error };
    } finally {
      this.testing = false;
    }
  }

  async saveSettings(showMessage = true): Promise<void> {
    if (this.aiForm.invalid) {
      this.markFormGroupTouched(this.aiForm);
      return;
    }

    this.saving = true;
    this.error = null;
    this.successMessage = null;

    try {
      const formData: AiSettings = this.aiForm.value;
      await this.aiService.updateAiSettings(formData);

      if (showMessage) {
        this.successMessage = 'AI settings saved successfully!';
        setTimeout(() => {
          this.successMessage = null;
        }, 3000);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to save AI settings';
    } finally {
      this.saving = false;
    }
  }

  getProviderHelp(): string {
    const provider = this.aiForm.get('provider')?.value;

    switch (provider) {
      case 'ollama':
        return 'Install Ollama from ollama.com, then run "ollama pull llama3.2" to download a model.';
      case 'lm-studio':
        return 'Install LM Studio from lmstudio.ai, download a model, and start the local server.';
      case 'openai':
        return 'Get an API key from platform.openai.com. Cloud provider - requires internet connection.';
      case 'anthropic':
        return 'Get an API key from console.anthropic.com. Cloud provider - requires internet connection.';
      default:
        return '';
    }
  }

  isLocalProvider(): boolean {
    const provider = this.aiForm.get('provider')?.value;
    return provider === 'ollama' || provider === 'lm-studio';
  }

  isCloudProvider(): boolean {
    const provider = this.aiForm.get('provider')?.value;
    return provider === 'openai' || provider === 'anthropic';
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();
    });
  }

  getFieldError(fieldName: string): string | null {
    const field = this.aiForm.get(fieldName);
    if (field && field.invalid && field.touched) {
      if (field.errors?.['required']) {
        return `${fieldName} is required`;
      }
      if (field.errors?.['min']) {
        return `${fieldName} must be at least ${field.errors['min'].min}`;
      }
      if (field.errors?.['max']) {
        return `${fieldName} must be at most ${field.errors['max'].max}`;
      }
    }
    return null;
  }

  hasAvailableModels(): boolean {
    return !!(this.testResult?.models && this.testResult.models.length > 0);
  }

  getAvailableModels(): string {
    return this.testResult?.models?.join(', ') || '';
  }
}
