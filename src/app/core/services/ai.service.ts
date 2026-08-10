import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { AiSettings } from '../interfaces/project.interface';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { requireProject } from '../utils/project.utils';

export interface AiGenerationOptions {
  context?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StructuredGenerationOptions {
  /**
   * Required: callers must size this for their schema. The settings-level
   * maxTokens is tuned for short name generation and truncates larger JSON.
   */
  maxTokens: number;
  temperature?: number;
  /** Defaults to 120s; local models can take well over the 30s IPC default. */
  timeoutMs?: number;
}

/**
 * Extracts a JSON payload from raw model output. Local models often wrap JSON
 * in markdown fences or prose, so we parse the outermost object/array found.
 */
export function parseStructuredJson<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new Error('AI choked answering. Please try again.');
  }
}

export interface AiTestConnectionResult {
  success: boolean;
  error?: string;
  models?: string[];
  serverVersion?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private aiSettings$ = new BehaviorSubject<AiSettings | null>(null);

  constructor(private electronService: ElectronService, private projectService: ProjectService) {
    // Subscribe to project changes to load AI settings
    this.projectService.currentProject$.pipe(takeUntilDestroyed()).subscribe((project) => {
      if (project?.metadata.settings.ai) {
        this.aiSettings$.next(project.metadata.settings.ai);
      } else {
        // Set default AI settings if not configured
        this.aiSettings$.next(this.getDefaultAiSettings());
      }
    });
  }

  getAiSettings(): Observable<AiSettings | null> {
    return this.aiSettings$.asObservable();
  }

  getCurrentAiSettings(): AiSettings | null {
    return this.aiSettings$.value;
  }

  private getDefaultAiSettings(): AiSettings {
    return {
      enabled: false,
      provider: 'ollama',
      localServerUrl: 'http://localhost:11434',
      modelName: 'llama3.2',
      temperature: 0.7,
      maxTokens: 100,
    };
  }

  async updateAiSettings(settings: Partial<AiSettings>): Promise<void> {
    const currentSettings = this.getCurrentAiSettings() || this.getDefaultAiSettings();
    const updatedSettings = { ...currentSettings, ...settings };

    // Update in project metadata
    const project = requireProject(this.projectService.getCurrentProject());

    const updatedMetadata = {
      ...project.metadata,
      settings: {
        ...project.metadata.settings,
        ai: updatedSettings,
      },
    };

    await this.projectService.updateMetadata(updatedMetadata);
    this.aiSettings$.next(updatedSettings);
  }

  async testConnection(): Promise<AiTestConnectionResult> {
    const settings = this.getCurrentAiSettings();

    if (!settings) {
      return { success: false, error: 'AI settings not configured' };
    }

    try {
      if (settings.provider === 'ollama') {
        return await this.testOllamaConnection(settings);
      } else if (settings.provider === 'lm-studio') {
        return await this.testLmStudioConnection(settings);
      } else {
        return { success: false, error: `Provider ${settings.provider} not yet implemented` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async testOllamaConnection(settings: AiSettings): Promise<AiTestConnectionResult> {
    try {
      // Test connection by calling the tags endpoint to list models
      const url = `${settings.localServerUrl}/api/tags`;
      const response = await this.makeHttpRequest(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.status === 200 && response.data) {
        const models = response.data.models?.map((m: any) => m.name) || [];
        return {
          success: true,
          models: models,
          serverVersion: response.data.version,
        };
      } else {
        return {
          success: false,
          error: `Server returned status ${response.status}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Cannot connect to Ollama at ${settings.localServerUrl}. Is Ollama running?`,
      };
    }
  }

  private async testLmStudioConnection(settings: AiSettings): Promise<AiTestConnectionResult> {
    try {
      const url = `${settings.localServerUrl}/api/v1/models`;
      const response = await this.makeHttpRequest(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.status === 200 && response.data) {
        const models = response.data.models?.map((model: any) => model.key) || [];
        return {
          success: true,
          models: models,
        };
      } else {
        return {
          success: false,
          error: `Server returned status ${response.status}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Cannot connect to LM Studio at ${settings.localServerUrl}. Is LM Studio running?`,
      };
    }
  }

  /**
   * Prompts the configured provider for a JSON response and returns it parsed.
   * This is the single structured-generation entry point every AI feature
   * (name generation, drafts, ideas, …) should build on.
   */
  async generateStructured<T>(prompt: string, options: StructuredGenerationOptions): Promise<T> {
    const settings = this.getCurrentAiSettings();

    if (!settings || !settings.enabled) {
      throw new Error('AI is not enabled. Please configure AI settings first.');
    }

    let raw: string;
    if (settings.provider === 'ollama') {
      raw = await this.generateWithOllama(prompt, settings, options);
    } else if (settings.provider === 'lm-studio') {
      raw = await this.generateWithLmStudio(prompt, settings, options);
    } else {
      throw new Error(`Provider ${settings.provider} not yet implemented`);
    }

    if (!raw) {
      throw new Error('No response generated');
    }
    return parseStructuredJson<T>(raw);
  }

  async generateCharacterName(options: AiGenerationOptions = {}): Promise<string> {
    const settings = this.getCurrentAiSettings();
    const prompt = this.buildNameGenerationPrompt(options.context || '');

    try {
      const result = await this.generateStructured<{ name: string }>(prompt, {
        // Reasoning models may use several hundred tokens before producing the
        // short JSON answer. Keep the user setting when it is already larger.
        maxTokens: Math.max(options.maxTokens ?? settings?.maxTokens ?? 1000, 1000),
        // Use moderate-high temperature for creative but coherent name generation
        temperature: options.temperature ?? 0.8,
      });
      if (!result?.name) {
        throw new Error('AI choked answering. Please try again.');
      }
      return result.name;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('AI is not enabled')) {
        throw error;
      }
      throw new Error(`Failed to generate name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private buildNameGenerationPrompt(context: string): string {
    const soundProfiles = [
      'Use soft consonants and open vowels.',
      'Use crisp consonants and short syllables.',
      'Use liquid consonants and a three-syllable rhythm.',
      'Use two compact syllables with an unusual vowel rhythm.',
      'Combine familiar phonemes in an unexpected way.',
      'Use a vowel-rich sound with few consonant clusters.',
    ];
    const soundProfile = soundProfiles[Math.floor(Math.random() * soundProfiles.length)];
    let prompt = 'Generate one unique, pronounceable character name. ';
    prompt += `${soundProfile} `;

    if (context) {
      prompt += `Context: ${context}. `;
    }

    prompt += 'Avoid overused names such as Aria, Elara, Kael, and Theron. ';
    prompt += 'Return exactly: {"name": "YourName"}';

    return prompt;
  }

  private async generateWithOllama(
    prompt: string,
    settings: AiSettings,
    options: StructuredGenerationOptions
  ): Promise<string> {
    const url = `${settings.localServerUrl}/api/generate`;

    const requestBody = {
      model: settings.modelName,
      prompt: prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: options.temperature ?? settings.temperature,
        num_predict: options.maxTokens,
        seed: Math.floor(Math.random() * 1000000), // Random seed for variety
        top_k: 40, // Consider top 40 tokens
        top_p: 0.9, // Nucleus sampling for diversity
        repeat_penalty: 1.1, // Slightly discourage repetition
      },
    };

    const response = await this.makeHttpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      timeout: options.timeoutMs ?? 120000,
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`Server returned status ${response.status}`);
    }
    return response.data.response?.trim() || '';
  }

  private async generateWithLmStudio(
    prompt: string,
    settings: AiSettings,
    options: StructuredGenerationOptions
  ): Promise<string> {
    const url = `${settings.localServerUrl}/api/v1/chat`;

    const requestBody = {
      model: settings.modelName,
      system_prompt: 'Reason carefully, then return the final answer as valid JSON only.',
      input: prompt,
      temperature: options.temperature ?? settings.temperature,
      max_output_tokens: options.maxTokens,
      reasoning: 'on',
    };

    const response = await this.makeHttpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: requestBody,
      timeout: options.timeoutMs ?? 120000,
    });

    if (response.status !== 200 || response.data?.error) {
      const serverError =
        typeof response.data?.error === 'string'
          ? response.data.error
          : response.data?.error?.message;
      throw new Error(serverError || `Server returned status ${response.status}`);
    }
    const message = response.data.output?.find((item: any) => item.type === 'message');
    return typeof message?.content === 'string' ? message.content.trim() : '';
  }

  private async makeHttpRequest(url: string, options: any): Promise<any> {
    if (!this.electronService.isElectron()) {
      throw new Error('HTTP requests are only available in Electron environment');
    }

    const response: any = await this.electronService.aiRequest(url, options);
    // main.js never rejects for ai-request: surface errors here as exceptions so
    // callers (which expect a { status, headers, data } shape) behave as before.
    if (response && response.success === false) {
      throw new Error(response.error || 'AI request failed');
    }
    return response;
  }
}
