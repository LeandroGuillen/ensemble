import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AiSettings } from '../interfaces/project.interface';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';

export interface AiGenerationOptions {
  context?: string;
  maxTokens?: number;
  temperature?: number;
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
    this.projectService.currentProject$.subscribe((project) => {
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
    const project = this.projectService.getCurrentProject();
    if (!project) {
      throw new Error('No project loaded');
    }

    const updatedMetadata = {
      ...project.metadata,
      settings: {
        ...project.metadata.settings,
        ai: updatedSettings,
      },
    };

    const ensembleJsonPath = await this.electronService.pathJoin(project.path, 'ensemble.json');
    const result = await this.electronService.writeFileAtomic(
      ensembleJsonPath,
      JSON.stringify(updatedMetadata, null, 2)
    );

    if (result.success) {
      this.aiSettings$.next(updatedSettings);
      // Reload the project to get the updated metadata
      await this.projectService.loadProject(project.path);
    } else {
      throw new Error(result.error || 'Failed to save AI settings');
    }
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
      // LM Studio uses OpenAI-compatible API
      const url = `${settings.localServerUrl}/v1/models`;
      const response = await this.makeHttpRequest(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.status === 200 && response.data) {
        const models = response.data.data?.map((m: any) => m.id) || [];
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

  async generateCharacterName(options: AiGenerationOptions = {}): Promise<string> {
    const settings = this.getCurrentAiSettings();

    if (!settings || !settings.enabled) {
      throw new Error('AI is not enabled. Please configure AI settings first.');
    }

    const context = options.context || '';
    const prompt = this.buildNameGenerationPrompt(context);

    // Use moderate-high temperature for creative but coherent name generation
    const generationOptions = {
      ...options,
      temperature: options.temperature ?? 0.8, // Sweet spot for creativity + coherence
    };

    if (settings.provider === 'ollama') {
      return await this.generateWithOllama(prompt, settings, generationOptions);
    } else if (settings.provider === 'lm-studio') {
      return await this.generateWithLmStudio(prompt, settings, generationOptions);
    } else {
      throw new Error(`Provider ${settings.provider} not yet implemented`);
    }
  }

  private buildNameGenerationPrompt(context: string): string {
    // Add some randomness to vary the prompt
    const randomNum = Math.floor(Math.random() * 100);

    let prompt = 'Generate a unique, pronounceable character name. ';
    prompt += 'The name should be memorable, easy to say, and feel natural. ';
    prompt += 'Vary your choices - try different cultural origins, lengths, and sounds. ';
    prompt += 'Avoid overused fantasy names like Aria, Elara, Kael, or Theron. ';

    if (context) {
      prompt += `Context: ${context}. `;
    }

    // Add variation to the prompt itself
    if (randomNum < 33) {
      prompt += 'Consider names from various cultures around the world. ';
    } else if (randomNum < 66) {
      prompt += 'Think of names with interesting but natural sound combinations. ';
    } else {
      prompt += 'Mix familiar sounds in new ways to create fresh names. ';
    }

    prompt += 'The name must be easy to pronounce and remember. ';
    prompt += 'Respond with JSON: {"name": "YourName"}';

    return prompt;
  }

  private async generateWithOllama(
    prompt: string,
    settings: AiSettings,
    options: AiGenerationOptions
  ): Promise<string> {
    const url = `${settings.localServerUrl}/api/generate`;

    const requestBody = {
      model: settings.modelName,
      prompt: prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: options.temperature || settings.temperature,
        num_predict: options.maxTokens || settings.maxTokens,
        seed: Math.floor(Math.random() * 1000000), // Random seed for variety
        top_k: 40, // Consider top 40 tokens
        top_p: 0.9, // Nucleus sampling for diversity
        repeat_penalty: 1.1, // Slightly discourage repetition
      },
    };

    try {
      const response = await this.makeHttpRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.status === 200 && response.data) {
        const generatedText = response.data.response?.trim() || '';

        if (!generatedText) {
          throw new Error('No response generated');
        }
        try {
          const jsonResponse = JSON.parse(generatedText);
          return jsonResponse.name;
        } catch {
          throw new Error(`AI choked answering. Please try again.`);
        }
      } else {
        throw new Error(`Server returned status ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Failed to generate name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async generateWithLmStudio(
    prompt: string,
    settings: AiSettings,
    options: AiGenerationOptions
  ): Promise<string> {
    const url = `${settings.localServerUrl}/v1/chat/completions`;

    const requestBody = {
      model: settings.modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || settings.temperature,
      max_tokens: options.maxTokens || settings.maxTokens,
    };

    if (settings.apiKey) {
      // Add API key to headers if provided
    }

    try {
      const response = await this.makeHttpRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: requestBody,
      });

      if (response.status === 200 && response.data) {
        const generatedText = response.data.choices?.[0]?.message?.content?.trim() || '';

        if (!generatedText) {
          throw new Error('No response generated');
        }

        const jsonResponse = JSON.parse(generatedText);
        return jsonResponse.name;
      } else {
        throw new Error(`Server returned status ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Failed to generate name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async makeHttpRequest(url: string, options: any): Promise<any> {
    if (!this.electronService.isElectron()) {
      throw new Error('HTTP requests are only available in Electron environment');
    }

    try {
      const response = await this.electronService.ipcRenderer.invoke('ai-request', url, options);
      return response;
    } catch (error) {
      throw error;
    }
  }
}
