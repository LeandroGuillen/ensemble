import {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageWorkflow,
  WorkflowFieldIdentifier,
} from '../../interfaces/image-generation.interface';
import { ElectronService } from '../electron.service';

interface InvokeWorkflowRecord {
  workflow_id: string;
  name: string;
  description?: string;
  workflow: any;
}

export class InvokeAiProvider implements ImageGenerationProvider {
  constructor(
    private electronService: ElectronService,
    private baseUrl: string
  ) {
    this.baseUrl = normalizeInvokeAiBaseUrl(baseUrl);
  }

  async testConnection(): Promise<{ success: boolean; error?: string; version?: string }> {
    try {
      const response = await this.request('/api/v1/app/version');
      if (response.status !== 200) {
        return { success: false, error: `InvokeAI returned status ${response.status}` };
      }
      return { success: true, version: response.data?.version };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  async listWorkflows(): Promise<ImageWorkflow[]> {
    const response = await this.request('/api/v1/workflows/?page=0&per_page=100');
    if (response.status !== 200 || !Array.isArray(response.data?.items)) {
      throw new Error(`Unable to list InvokeAI workflows (status ${response.status})`);
    }

    const records = await Promise.all(
      response.data.items.map((item: any) => this.getWorkflowRecord(item.workflow_id))
    );
    return records
      .map((record) => toCompatibleWorkflow(record))
      .filter((workflow): workflow is ImageWorkflow => workflow !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const record = await this.getWorkflowRecord(request.workflowId);
    const compatible = toCompatibleWorkflow(record);
    if (!compatible) {
      throw new Error('The selected workflow must expose Positive Prompt and Negative Prompt string fields');
    }

    const graph = buildInvokeGraph(
      record.workflow,
      compatible.positivePromptField,
      compatible.negativePromptField,
      request.positivePrompt,
      request.negativePrompt
    );

    const enqueue = await this.request('/api/v1/queue/default/enqueue_batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        batch: {
          graph,
          runs: 1,
          origin: 'ensemble',
        },
      },
      timeout: 30000,
    });
    const itemId = enqueue.data?.item_ids?.[0];
    if (enqueue.status !== 200 || itemId === undefined) {
      throw new Error(
        errorMessage(
          enqueue.data?.detail,
          `InvokeAI could not enqueue the workflow (status ${enqueue.status})`
        )
      );
    }

    const item = await this.waitForQueueItem(itemId);
    const imageName = extractImageName(item.session?.results);
    if (!imageName) {
      throw new Error('InvokeAI completed without returning an image');
    }
    const extension = imageName.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'png';
    return {
      providerImageName: imageName,
      extension,
      contentType: imageContentType(extension),
    };
  }

  async download(image: GeneratedImage, destinationPath: string): Promise<void> {
    const encodedName = encodeURIComponent(image.providerImageName);
    const result = await this.electronService.downloadImage(
      `${this.baseUrl}/api/v1/images/i/${encodedName}/full`,
      destinationPath,
      { timeout: 120000 }
    );
    if (!result.success) {
      throw new Error(result.error || 'Failed to download generated image');
    }
  }

  private async getWorkflowRecord(workflowId: string): Promise<InvokeWorkflowRecord> {
    const response = await this.request(`/api/v1/workflows/i/${encodeURIComponent(workflowId)}`);
    if (response.status !== 200 || !response.data?.workflow) {
      throw new Error(`Unable to load InvokeAI workflow (status ${response.status})`);
    }
    return response.data as InvokeWorkflowRecord;
  }

  private async waitForQueueItem(itemId: number): Promise<any> {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await this.request(`/api/v1/queue/default/i/${itemId}`, {
        timeout: 30000,
      });
      if (response.status !== 200) {
        throw new Error(`Unable to read InvokeAI queue item (status ${response.status})`);
      }
      const item = response.data;
      if (item.status === 'completed') return item;
      if (item.status === 'failed') {
        throw new Error(errorMessage(item.error_message, 'InvokeAI generation failed'));
      }
      if (item.status === 'canceled') {
        throw new Error('InvokeAI generation was canceled');
      }
      await delay(750);
    }
    throw new Error('InvokeAI generation timed out after 10 minutes');
  }

  private async request(path: string, options: any = {}): Promise<any> {
    return await this.electronService.aiRequest(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || { Accept: 'application/json' },
      body: options.body,
      timeout: options.timeout || 30000,
    });
  }
}

export function normalizeInvokeAiBaseUrl(url: string): string {
  const trimmed = (url || '').trim().replace(/\/+$/, '');
  return trimmed.endsWith('/app') ? trimmed.slice(0, -4) : trimmed;
}

export function toCompatibleWorkflow(record: InvokeWorkflowRecord): ImageWorkflow | null {
  const workflow = record.workflow;
  if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.exposedFields)) {
    return null;
  }
  const positive = findPromptField(workflow, 'positive');
  const negative = findPromptField(workflow, 'negative');
  if (!positive || !negative) return null;
  const templates = extractWorkflowPromptTemplates(workflow, positive, negative);
  return {
    id: record.workflow_id,
    name: record.name,
    description: record.description || workflow.description,
    positivePromptField: positive,
    negativePromptField: negative,
    positivePromptTemplate: templates.positive,
    negativePromptTemplate: templates.negative,
  };
}

export function extractWorkflowPromptTemplates(
  workflow: any,
  positiveField: WorkflowFieldIdentifier,
  negativeField: WorkflowFieldIdentifier
): { positive?: string; negative?: string } {
  const positive = extractTemplateForPromptField(workflow, positiveField);
  const negative = extractTemplateForPromptField(workflow, negativeField);
  return {
    ...(positive ? { positive } : {}),
    ...(negative ? { negative } : {}),
  };
}

function extractTemplateForPromptField(workflow: any, field: WorkflowFieldIdentifier): string | undefined {
  for (const edge of workflow.edges || []) {
    if (edge.source !== field.nodeId || edge.sourceHandle !== 'value') continue;
    if (edge.targetHandle !== 'string_left' && edge.targetHandle !== 'string_right') continue;

    const joinNode = (workflow.nodes || []).find(
      (candidate: any) => candidate.id === edge.target && candidate.data?.type === 'string_join'
    );
    if (!joinNode) continue;

    const characterSide = edge.targetHandle as 'string_left' | 'string_right';
    const templateSide = characterSide === 'string_left' ? 'string_right' : 'string_left';
    const template = readStaticStringInput(joinNode, templateSide);
    if (template) return template;

    const templateEdge = (workflow.edges || []).find(
      (candidate: any) =>
        candidate.target === joinNode.id &&
        candidate.targetHandle === templateSide &&
        candidate.sourceHandle === 'value'
    );
    if (!templateEdge) continue;

    const templateNode = (workflow.nodes || []).find((candidate: any) => candidate.id === templateEdge.source);
    if (templateNode?.data?.type === 'string') {
      const value = readStaticStringInput(templateNode, 'value');
      if (value) return value;
    }
  }
  return undefined;
}

function readStaticStringInput(node: any, fieldName: string): string | undefined {
  const value = node?.data?.inputs?.[fieldName]?.value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function findPromptField(workflow: any, kind: 'positive' | 'negative'): WorkflowFieldIdentifier | null {
  for (const field of workflow.exposedFields) {
    const node = workflow.nodes.find((candidate: any) => candidate.id === field.nodeId);
    const input = node?.data?.inputs?.[field.fieldName];
    const labels = `${node?.data?.label || ''} ${input?.label || ''}`.toLowerCase();
    if (node?.type === 'invocation' && node.data?.type === 'string' && labels.includes(`${kind} prompt`)) {
      return { nodeId: field.nodeId, fieldName: field.fieldName };
    }
  }
  return null;
}

export function buildInvokeGraph(
  workflow: any,
  positiveField: WorkflowFieldIdentifier,
  negativeField: WorkflowFieldIdentifier,
  positivePrompt: string,
  negativePrompt: string
): any {
  const nodes: Record<string, any> = {};
  for (const workflowNode of workflow.nodes || []) {
    if (workflowNode.type !== 'invocation') continue;
    const data = workflowNode.data;
    const node: Record<string, any> = {
      id: data.id || workflowNode.id,
      type: data.type,
      is_intermediate: data.isIntermediate ?? true,
      use_cache: data.useCache ?? true,
    };
    for (const [fieldName, input] of Object.entries<any>(data.inputs || {})) {
      if (Object.prototype.hasOwnProperty.call(input, 'value')) {
        const value = input.value;
        if (fieldName === 'board' && typeof value === 'string') {
          // InvokeAI workflows store UI choices such as "auto" as strings, but
          // the execution API requires a BoardField object or an omitted value.
          if (value === 'auto' || value === 'none' || value === '') continue;
          node[fieldName] = { board_id: value };
        } else {
          node[fieldName] = value;
        }
      }
    }
    nodes[node['id']] = node;
  }

  setGraphField(nodes, positiveField, positivePrompt);
  setGraphField(nodes, negativeField, negativePrompt);

  const edges = (workflow.edges || [])
    .filter((edge: any) => edge.sourceHandle && edge.targetHandle)
    .map((edge: any) => ({
      source: { node_id: edge.source, field: edge.sourceHandle },
      destination: { node_id: edge.target, field: edge.targetHandle },
    }));

  return {
    id: workflow.id || `ensemble-${Date.now()}`,
    nodes,
    edges,
  };
}

function setGraphField(
  nodes: Record<string, any>,
  field: WorkflowFieldIdentifier,
  value: string
): void {
  if (!nodes[field.nodeId]) {
    throw new Error(`Workflow prompt node ${field.nodeId} was not found`);
  }
  nodes[field.nodeId][field.fieldName] = value;
}

export function extractImageName(results: unknown): string | null {
  const found: string[] = [];
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.image_name === 'string') found.push(value.image_name);
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else {
      Object.values(value).forEach(visit);
    }
  };
  visit(results);
  return found.at(-1) || null;
}

function imageContentType(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown, fallback = 'Unknown InvokeAI error'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error.trim() || fallback;
  if (Array.isArray(error)) {
    const messages = error
      .map((item) => errorMessage(item, ''))
      .filter(Boolean);
    return messages.join('; ') || fallback;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = record['message'] ?? record['msg'];
    if (message) {
      const location = Array.isArray(record['loc'])
        ? record['loc'].map(String).join('.')
        : '';
      const formatted = errorMessage(message, fallback);
      return location ? `${location}: ${formatted}` : formatted;
    }
    for (const key of ['detail', 'error_message', 'error']) {
      if (record[key] !== undefined) {
        return errorMessage(record[key], fallback);
      }
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the readable fallback.
    }
  }
  return fallback;
}
