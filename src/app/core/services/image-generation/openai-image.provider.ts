import {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageWorkflow,
} from '../../interfaces/image-generation.interface';
import { CloudImageSettings } from '../../interfaces/project.interface';
import { ElectronService } from '../electron.service';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';

/**
 * Image generation via the OpenAI Images API (gpt-image-1 / dall-e models).
 * Cloud providers have no InvokeAI-style workflows, so a single pseudo-workflow
 * named after the model is exposed to keep the existing workflow-based UI flow.
 */
export class OpenAiImageProvider implements ImageGenerationProvider {
  constructor(
    private electronService: ElectronService,
    private settings: CloudImageSettings
  ) {}

  private get model(): string {
    return this.settings.model?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  }

  async testConnection(): Promise<{ success: boolean; error?: string; version?: string }> {
    if (!this.settings.apiKey?.trim()) {
      return { success: false, error: 'OpenAI API key is not configured' };
    }
    try {
      const response = await this.request('/models', { timeout: 15000 });
      if (response.status === 401) {
        return { success: false, error: 'OpenAI rejected the API key' };
      }
      if (response.status !== 200) {
        return { success: false, error: `OpenAI returned status ${response.status}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: cloudErrorMessage(error, 'Cannot reach OpenAI') };
    }
  }

  async listWorkflows(): Promise<ImageWorkflow[]> {
    return [pseudoWorkflow(this.model, `OpenAI · ${this.model}`)];
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    if (!this.settings.apiKey?.trim()) {
      throw new Error('OpenAI API key is not configured');
    }
    const prompt = combinePrompts(request.positivePrompt, request.negativePrompt);
    const response = await this.request('/images/generations', {
      method: 'POST',
      body: {
        model: this.model,
        prompt,
        n: 1,
        size: '1024x1024',
        // gpt-image-* always returns base64; dall-e models default to URLs.
        ...(this.model.startsWith('dall-e') ? { response_format: 'b64_json' } : {}),
      },
      timeout: 300000,
    });

    if (response.status !== 200) {
      throw new Error(
        cloudErrorMessage(response.data?.error?.message, `OpenAI returned status ${response.status}`)
      );
    }
    const item = response.data?.data?.[0];
    if (item?.b64_json) {
      return {
        providerImageName: `openai-${Date.now()}.png`,
        extension: 'png',
        contentType: 'image/png',
        base64Data: item.b64_json,
      };
    }
    if (item?.url) {
      return {
        providerImageName: `openai-${Date.now()}.png`,
        extension: 'png',
        contentType: 'image/png',
        remoteUrl: item.url,
      };
    }
    throw new Error('OpenAI completed without returning an image');
  }

  async download(image: GeneratedImage, destinationPath: string): Promise<void> {
    await saveCloudImage(this.electronService, image, destinationPath);
  }

  private async request(path: string, options: any = {}): Promise<any> {
    return await this.electronService.aiRequest(`${OPENAI_API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.apiKey.trim()}`,
      },
      body: options.body,
      timeout: options.timeout || 30000,
    });
  }
}

/** Shared helpers for cloud image providers. */

export function pseudoWorkflow(id: string, name: string): ImageWorkflow {
  return {
    id,
    name,
    description: 'Cloud image model',
    positivePromptField: { nodeId: '', fieldName: '' },
    negativePromptField: { nodeId: '', fieldName: '' },
  };
}

/** Cloud APIs have no negative-prompt field, so fold it into the prompt text. */
export function combinePrompts(positive: string, negative: string): string {
  const pos = positive.trim();
  const neg = negative.trim();
  return neg ? `${pos}\n\nDo not include: ${neg}` : pos;
}

export async function saveCloudImage(
  electronService: ElectronService,
  image: GeneratedImage,
  destinationPath: string
): Promise<void> {
  if (image.base64Data) {
    const result = await electronService.saveBase64Image(image.base64Data, destinationPath);
    if (!result.success) {
      throw new Error(result.error || 'Failed to save generated image');
    }
    return;
  }
  if (image.remoteUrl) {
    const result = await electronService.downloadImage(image.remoteUrl, destinationPath, {
      timeout: 120000,
    });
    if (!result.success) {
      throw new Error(result.error || 'Failed to download generated image');
    }
    return;
  }
  throw new Error('Generated image has no downloadable content');
}

export function cloudErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}
