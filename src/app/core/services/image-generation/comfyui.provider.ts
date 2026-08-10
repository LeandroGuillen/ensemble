import {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageWorkflow,
  WorkflowFieldIdentifier,
} from '../../interfaces/image-generation.interface';
import { asciiSlugify } from '../../utils/slug.utils';
import { ElectronService } from '../electron.service';

interface ComfyApiNode {
  class_type: string;
  inputs?: Record<string, unknown>;
  _meta?: { title?: string };
}

type ComfyApiPrompt = Record<string, ComfyApiNode>;

/**
 * Image generation via a local/self-hosted ComfyUI server.
 *
 * Compatible workflows expose nodes titled "Positive Prompt" and "Negative Prompt"
 * (StringConcatenate, CLIPTextEncode, or PrimitiveString*). For StringConcatenate,
 * Ensemble writes the character prompt into `string_b` and keeps `string_a` as the
 * fixed template prefix — the same pattern as InvokeAI String Join nodes.
 */
export class ComfyUiProvider implements ImageGenerationProvider {
  constructor(
    private electronService: ElectronService,
    private baseUrl: string
  ) {
    this.baseUrl = normalizeComfyUiBaseUrl(baseUrl);
  }

  async testConnection(): Promise<{ success: boolean; error?: string; version?: string }> {
    try {
      const response = await this.request('/system_stats');
      if (response.status !== 200) {
        return { success: false, error: `ComfyUI returned status ${response.status}` };
      }
      const version = response.data?.system?.comfyui_version;
      return { success: true, version: typeof version === 'string' ? version : undefined };
    } catch (error) {
      return { success: false, error: errorMessage(error, 'Cannot reach ComfyUI') };
    }
  }

  async listWorkflows(): Promise<ImageWorkflow[]> {
    const names = await this.listWorkflowFilenames();
    const workflows: ImageWorkflow[] = [];
    for (const name of names) {
      try {
        const raw = await this.loadWorkflowJson(name);
        const compatible = toCompatibleComfyWorkflow(name, raw);
        if (compatible) workflows.push(compatible);
      } catch {
        // Skip unreadable / incompatible workflows.
      }
    }
    return workflows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const raw = await this.loadWorkflowJson(request.workflowId);
    const prompt = await this.toApiPrompt(raw);
    const compatible = findPromptFieldsInApiPrompt(prompt);
    if (!compatible) {
      throw new Error(
        'The selected workflow must expose Positive Prompt and Negative Prompt nodes'
      );
    }

    applyComfyPrompts(prompt, compatible.positive, compatible.negative, request);
    randomizeComfySeeds(prompt);
    applyComfyFilenamePrefix(prompt, request.characterName);

    const clientId = `ensemble-${Date.now()}`;
    const enqueue = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { prompt, client_id: clientId },
      timeout: 60000,
    });
    const promptId = enqueue.data?.prompt_id;
    if (enqueue.status !== 200 || !promptId) {
      throw new Error(
        errorMessage(
          enqueue.data?.error || enqueue.data?.node_errors,
          `ComfyUI could not queue the workflow (status ${enqueue.status})`
        )
      );
    }

    const historyItem = await this.waitForPrompt(promptId);
    const imageRef = extractComfyImageRef(historyItem?.outputs);
    if (!imageRef) {
      throw new Error('ComfyUI completed without returning an image');
    }
    const extension = imageRef.filename.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'png';
    return {
      providerImageName: imageRef.filename,
      extension,
      contentType: imageContentType(extension),
      remoteUrl: this.viewUrl(imageRef),
    };
  }

  async download(image: GeneratedImage, destinationPath: string): Promise<void> {
    const url = image.remoteUrl;
    if (!url) {
      throw new Error('Generated ComfyUI image has no download URL');
    }
    const result = await this.electronService.downloadImage(url, destinationPath, {
      timeout: 120000,
    });
    if (!result.success) {
      throw new Error(result.error || 'Failed to download generated image');
    }
  }

  private viewUrl(image: { filename: string; subfolder?: string; type?: string }): string {
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder || '',
      type: image.type || 'output',
    });
    return `${this.baseUrl}/view?${params.toString()}`;
  }

  private async listWorkflowFilenames(): Promise<string[]> {
    const response = await this.request(
      '/api/userdata?dir=workflows&recurse=true&split=false',
      { timeout: 30000 }
    );
    if (response.status !== 200) {
      throw new Error(`Unable to list ComfyUI workflows (status ${response.status})`);
    }
    const items = response.data;
    if (!Array.isArray(items)) {
      throw new Error('ComfyUI returned an unexpected workflow list');
    }
    return items
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (Array.isArray(item) && typeof item[0] === 'string') return item[0];
        return '';
      })
      .filter((name: string) => name.toLowerCase().endsWith('.json'));
  }

  private async loadWorkflowJson(workflowId: string): Promise<any> {
    const encoded = workflowId
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('%2F');
    const response = await this.request(`/api/userdata/workflows%2F${encoded}`, {
      timeout: 60000,
    });
    if (response.status !== 200) {
      throw new Error(`Unable to load ComfyUI workflow "${workflowId}" (status ${response.status})`);
    }
    if (typeof response.data === 'string') {
      try {
        return JSON.parse(response.data);
      } catch {
        throw new Error(`ComfyUI workflow "${workflowId}" is not valid JSON`);
      }
    }
    return response.data;
  }

  private async toApiPrompt(workflow: any): Promise<ComfyApiPrompt> {
    if (isComfyApiFormat(workflow)) {
      return workflow as ComfyApiPrompt;
    }
    throw new Error(
      'This ComfyUI workflow is UI format. In ComfyUI use File → Export (API), save the JSON into the workflows folder, then reload workflows in Ensemble.'
    );
  }

  private async waitForPrompt(promptId: string): Promise<any> {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await this.request(`/history/${encodeURIComponent(promptId)}`, {
        timeout: 30000,
      });
      if (response.status !== 200) {
        throw new Error(`Unable to read ComfyUI history (status ${response.status})`);
      }
      const item = response.data?.[promptId];
      if (item) {
        const status = item.status?.status_str || item.status?.completed;
        if (item.status?.status_str === 'error' || item.status?.status_str === 'failed') {
          throw new Error(
            errorMessage(item.status?.messages, 'ComfyUI generation failed')
          );
        }
        if (item.outputs || status === 'success' || item.status?.completed) {
          return item;
        }
      }
      await delay(750);
    }
    throw new Error('ComfyUI generation timed out after 10 minutes');
  }

  private async request(path: string, options: any = {}): Promise<any> {
    const response = await this.electronService.aiRequest(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || { Accept: 'application/json' },
      body: options.body,
      timeout: options.timeout || 30000,
    });
    if (response && response.success === false) {
      throw new Error(response.error || 'ComfyUI request failed');
    }
    return response;
  }
}

export function normalizeComfyUiBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

export function isComfyApiFormat(workflow: unknown): boolean {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return false;
  const record = workflow as Record<string, unknown>;
  if (Array.isArray(record['nodes']) && Array.isArray(record['links'])) return false;
  for (const [key, value] of Object.entries(record)) {
    if (key === 'prompt' || key === 'extra_data' || key === 'client_id') continue;
    if (value && typeof value === 'object' && typeof (value as any).class_type === 'string') {
      return true;
    }
  }
  return false;
}

/** Detect compatible prompt fields from an API-format ComfyUI workflow. */
export function toCompatibleComfyWorkflow(
  workflowId: string,
  workflow: any
): ImageWorkflow | null {
  if (!isComfyApiFormat(workflow)) {
    return null;
  }
  const fields = findPromptFieldsInApiPrompt(workflow as ComfyApiPrompt);
  if (!fields) return null;
  return {
    id: workflowId,
    name: workflowDisplayName(workflowId),
    description: 'ComfyUI workflow',
    positivePromptField: fields.positive,
    negativePromptField: fields.negative,
    positivePromptTemplate: fields.positiveTemplate,
    negativePromptTemplate: fields.negativeTemplate,
  };
}

export function findPromptFieldsInApiPrompt(prompt: ComfyApiPrompt): {
  positive: WorkflowFieldIdentifier;
  negative: WorkflowFieldIdentifier;
  positiveTemplate?: string;
  negativeTemplate?: string;
} | null {
  const positive = findApiPromptField(prompt, 'positive');
  const negative = findApiPromptField(prompt, 'negative');
  if (!positive || !negative) return null;
  return {
    positive: positive.field,
    negative: negative.field,
    positiveTemplate: positive.template,
    negativeTemplate: negative.template,
  };
}

export function applyComfyPrompts(
  prompt: ComfyApiPrompt,
  positiveField: WorkflowFieldIdentifier,
  negativeField: WorkflowFieldIdentifier,
  request: Pick<ImageGenerationRequest, 'positivePrompt' | 'negativePrompt'>
): void {
  setPromptInput(prompt, positiveField, request.positivePrompt);
  setPromptInput(prompt, negativeField, request.negativePrompt);
}

export function randomizeComfySeeds(prompt: ComfyApiPrompt): void {
  for (const node of Object.values(prompt)) {
    if (!node?.inputs || typeof node.inputs !== 'object') continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (key.toLowerCase() === 'seed' && typeof value === 'number') {
        node.inputs[key] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      }
    }
  }
}

export function applyComfyFilenamePrefix(prompt: ComfyApiPrompt, characterName: string): void {
  const prefix = asciiSlugify(characterName) || 'character';
  for (const node of Object.values(prompt)) {
    if (node.class_type !== 'SaveImage' || !node.inputs) continue;
    const current = node.inputs['filename_prefix'];
    // Only replace literal prefixes; leave linked values alone.
    if (typeof current === 'string' || current === undefined) {
      node.inputs['filename_prefix'] = prefix;
    }
  }
}

export function extractComfyImageRef(outputs: unknown): {
  filename: string;
  subfolder?: string;
  type?: string;
} | null {
  if (!outputs || typeof outputs !== 'object') return null;
  const found: Array<{ filename: string; subfolder?: string; type?: string }> = [];
  for (const nodeOutput of Object.values(outputs as Record<string, any>)) {
    const images = nodeOutput?.images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (image && typeof image.filename === 'string') {
        // Prefer permanent output images over temp/preview.
        if (image.type === 'output' || !image.type) {
          found.push(image);
        }
      }
    }
  }
  return found.at(-1) || null;
}

function findApiPromptField(
  prompt: ComfyApiPrompt,
  kind: 'positive' | 'negative'
): { field: WorkflowFieldIdentifier; template?: string } | null {
  const needle = `${kind} prompt`;
  for (const [nodeId, node] of Object.entries(prompt)) {
    const title = String(node._meta?.title || '').toLowerCase();
    if (!title.includes(needle)) continue;
    const mapped = mapPromptClassToField(nodeId, node);
    if (mapped) return mapped;
  }
  return null;
}

function mapPromptClassToField(
  nodeId: string,
  node: ComfyApiNode
): { field: WorkflowFieldIdentifier; template?: string } | null {
  const type = node.class_type;
  if (type === 'StringConcatenate') {
    const template =
      typeof node.inputs?.['string_a'] === 'string' ? node.inputs['string_a'] : undefined;
    return {
      field: { nodeId, fieldName: 'string_b' },
      template: template?.trim() || undefined,
    };
  }
  if (type === 'CLIPTextEncode') {
    return { field: { nodeId, fieldName: 'text' } };
  }
  if (
    type === 'PrimitiveString' ||
    type === 'PrimitiveStringMultiline' ||
    type === 'StringLiteral' ||
    type === 'Text'
  ) {
    return { field: { nodeId, fieldName: 'value' } };
  }
  return null;
}

function setPromptInput(
  prompt: ComfyApiPrompt,
  field: WorkflowFieldIdentifier,
  value: string
): void {
  const node = prompt[field.nodeId];
  if (!node) {
    throw new Error(`Workflow prompt node ${field.nodeId} was not found after conversion`);
  }
  if (!node.inputs) node.inputs = {};
  node.inputs[field.fieldName] = value;
}

function workflowDisplayName(workflowId: string): string {
  const base = workflowId.split('/').pop() || workflowId;
  return base.replace(/\.json$/i, '');
}

function imageContentType(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown, fallback = 'Unknown ComfyUI error'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (Array.isArray(error)) {
    const parts = error
      .map((item) => errorMessage(item, ''))
      .filter(Boolean);
    return parts.join('; ') || fallback;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail', 'type']) {
      if (record[key] !== undefined) {
        const nested = errorMessage(record[key], '');
        if (nested) return nested;
      }
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // fall through
    }
  }
  return fallback;
}
