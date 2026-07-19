import {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageWorkflow,
} from '../../interfaces/image-generation.interface';
import { CloudImageSettings } from '../../interfaces/project.interface';
import { ElectronService } from '../electron.service';
import {
  cloudErrorMessage,
  combinePrompts,
  pseudoWorkflow,
  saveCloudImage,
} from './openai-image.provider';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

/**
 * Image generation via the Google Gemini API (image-capable Gemini models).
 * Like the OpenAI provider, exposes a single pseudo-workflow named after the
 * model so the existing workflow-based UI flow keeps working.
 */
export class GeminiImageProvider implements ImageGenerationProvider {
  constructor(
    private electronService: ElectronService,
    private settings: CloudImageSettings
  ) {}

  private get model(): string {
    return this.settings.model?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
  }

  async testConnection(): Promise<{ success: boolean; error?: string; version?: string }> {
    if (!this.settings.apiKey?.trim()) {
      return { success: false, error: 'Gemini API key is not configured' };
    }
    try {
      const response = await this.request('/models?pageSize=1', { timeout: 15000 });
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { success: false, error: 'Gemini rejected the API key' };
      }
      if (response.status !== 200) {
        return { success: false, error: `Gemini returned status ${response.status}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: cloudErrorMessage(error, 'Cannot reach Gemini') };
    }
  }

  async listWorkflows(): Promise<ImageWorkflow[]> {
    return [pseudoWorkflow(this.model, `Gemini · ${this.model}`)];
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    if (!this.settings.apiKey?.trim()) {
      throw new Error('Gemini API key is not configured');
    }
    const prompt = combinePrompts(request.positivePrompt, request.negativePrompt);
    const response = await this.request(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        body: {
          contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
        },
        timeout: 300000,
      }
    );

    if (response.status !== 200) {
      throw new Error(
        cloudErrorMessage(response.data?.error?.message, `Gemini returned status ${response.status}`)
      );
    }
    const parts = response.data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part: any) => part?.inlineData?.data);
    if (!imagePart) {
      const refusal = parts.find((part: any) => typeof part?.text === 'string')?.text;
      throw new Error(
        refusal ? `Gemini returned no image: ${refusal}` : 'Gemini completed without returning an image'
      );
    }
    const mimeType: string = imagePart.inlineData.mimeType || 'image/png';
    const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    return {
      providerImageName: `gemini-${Date.now()}.${extension}`,
      extension,
      contentType: mimeType,
      base64Data: imagePart.inlineData.data,
    };
  }

  async download(image: GeneratedImage, destinationPath: string): Promise<void> {
    await saveCloudImage(this.electronService, image, destinationPath);
  }

  private async request(path: string, options: any = {}): Promise<any> {
    return await this.electronService.aiRequest(`${GEMINI_API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.settings.apiKey.trim(),
      },
      body: options.body,
      timeout: options.timeout || 30000,
    });
  }
}
