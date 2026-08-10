import { Injectable } from '@angular/core';
import {
  GeneratedImage,
  ImageGenerationRequest,
  ImageWorkflow,
  ProjectImage,
  ProjectImageDirectory,
} from '../../interfaces/image-generation.interface';
import { ImageGenerationSettings } from '../../interfaces/project.interface';
import { asciiSlugify } from '../../utils/slug.utils';
import { pathJoin } from '../../utils/path.utils';
import { requireProject } from '../../utils/project.utils';
import { ElectronService } from '../electron.service';
import { ProjectService } from '../project.service';
import {
  COMFY_WORKFLOWS_DIR,
  ComfyUiProvider,
  describeComfyWorkflowIncompatibility,
  resolveComfyWorkflowPath,
  safeComfyWorkflowFilename,
  toCompatibleComfyWorkflow,
} from './comfyui.provider';
import { GeminiImageProvider } from './gemini-image.provider';
import { InvokeAiProvider } from './invokeai.provider';
import { OpenAiImageProvider } from './openai-image.provider';

const IMAGE_PATTERNS = ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif'];

@Injectable({ providedIn: 'root' })
export class ImageGenerationService {
  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService
  ) {}

  getSettings(): ImageGenerationSettings {
    const stored = this.projectService.getCurrentProject()?.metadata.settings.imageGeneration;
    const defaults = defaultImageGenerationSettings();
    if (!stored) return defaults;
    // Older projects lack the cloud provider blocks; merge so they always exist.
    return {
      ...defaults,
      ...stored,
      invokeai: { ...defaults.invokeai, ...stored.invokeai },
      comfyui: { ...defaults.comfyui!, ...stored.comfyui },
      openai: { ...defaults.openai!, ...stored.openai },
      gemini: { ...defaults.gemini!, ...stored.gemini },
    };
  }

  async updateSettings(settings: ImageGenerationSettings): Promise<void> {
    const project = requireProject(this.projectService.getCurrentProject());
    const updatedMetadata = {
      ...project.metadata,
      settings: {
        ...project.metadata.settings,
        imageGeneration: {
          ...settings,
          invokeai: {
            ...settings.invokeai,
            baseUrl: settings.invokeai.baseUrl.trim().replace(/\/+$/, ''),
          },
          ...(settings.comfyui
            ? {
                comfyui: {
                  ...settings.comfyui,
                  baseUrl: settings.comfyui.baseUrl.trim().replace(/\/+$/, ''),
                },
              }
            : {}),
          ...(settings.openai
            ? { openai: { ...settings.openai, apiKey: settings.openai.apiKey.trim() } }
            : {}),
          ...(settings.gemini
            ? { gemini: { ...settings.gemini, apiKey: settings.gemini.apiKey.trim() } }
            : {}),
        },
      },
    };
    await this.projectService.updateMetadata(updatedMetadata);
  }

  /** Default workflow id for the active local workflow provider (InvokeAI / ComfyUI). */
  getDefaultWorkflowId(settings?: ImageGenerationSettings): string | undefined {
    const current = settings || this.getSettings();
    if (current.provider === 'comfyui') {
      return current.comfyui?.defaultWorkflowId;
    }
    if (current.provider === 'invokeai') {
      return current.invokeai.defaultWorkflowId;
    }
    return undefined;
  }

  async testConnection(settings?: ImageGenerationSettings) {
    return await this.provider(settings).testConnection();
  }

  async listWorkflows(settings?: ImageGenerationSettings): Promise<ImageWorkflow[]> {
    return await this.provider(settings).listWorkflows();
  }

  /** Absolute path to the project's `comfyui-workflows/` folder. */
  getComfyWorkflowsDirectory(): string {
    const project = requireProject(this.projectService.getCurrentProject());
    return pathJoin(project.path, COMFY_WORKFLOWS_DIR);
  }

  /**
   * Open a file picker, validate the selected ComfyUI API workflow, and copy it
   * into the project's `comfyui-workflows/` folder. Returns null if cancelled.
   */
  async pickAndImportComfyWorkflow(): Promise<ImageWorkflow | null> {
    const sourcePath = await this.electronService.selectJson();
    if (!sourcePath) return null;
    return await this.importComfyWorkflow(sourcePath);
  }

  /**
   * Copy a ComfyUI API-format workflow JSON into the project and return its
   * Ensemble workflow descriptor. Rejects UI-format graphs and workflows
   * missing titled Positive/Negative Prompt nodes.
   */
  async importComfyWorkflow(sourcePath: string): Promise<ImageWorkflow> {
    const workflowsDir = this.getComfyWorkflowsDirectory();
    const read = await this.electronService.readFile(sourcePath);
    if (!read.success || read.content === undefined) {
      throw new Error(read.error || 'Failed to read workflow file');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(read.content);
    } catch {
      throw new Error('Selected file is not valid JSON');
    }

    const filename = safeComfyWorkflowFilename(sourcePath);
    const compatible = toCompatibleComfyWorkflow(filename, raw);
    if (!compatible) {
      throw new Error(describeComfyWorkflowIncompatibility(raw));
    }

    const mkdir = await this.electronService.createDirectory(workflowsDir);
    if (!mkdir.success) {
      throw new Error(mkdir.error || 'Could not create comfyui-workflows folder');
    }

    const destName = await this.findAvailableWorkflowFilename(workflowsDir, filename);
    const destPath = resolveComfyWorkflowPath(workflowsDir, destName);
    const write = await this.electronService.writeFileAtomic(
      destPath,
      JSON.stringify(raw, null, 2)
    );
    if (!write.success) {
      throw new Error(write.error || 'Failed to save workflow into the project');
    }

    return { ...compatible, id: destName, name: destName.replace(/\.json$/i, '') };
  }

  /** Delete a project-local ComfyUI workflow and clear it as default if selected. */
  async deleteComfyWorkflow(workflowId: string): Promise<void> {
    const workflowsDir = this.getComfyWorkflowsDirectory();
    const filePath = resolveComfyWorkflowPath(workflowsDir, workflowId);
    const result = await this.electronService.deleteFile(filePath);
    if (!result.success) {
      throw new Error(result.error || `Failed to delete workflow "${workflowId}"`);
    }

    const settings = this.getSettings();
    if (settings.comfyui?.defaultWorkflowId === workflowId) {
      await this.updateSettings({
        ...settings,
        comfyui: {
          ...settings.comfyui,
          defaultWorkflowId: undefined,
        },
      });
    }
  }

  async generateAndSave(request: ImageGenerationRequest): Promise<string> {
    const project = requireProject(this.projectService.getCurrentProject());
    const settings = this.getSettings();
    if (!settings.enabled) throw new Error('Image generation is not enabled');

    const provider = this.provider(settings);
    const image = await provider.generate(request);
    const imagesFolder = project.metadata.settings.imagesFolder?.trim() || 'img';
    const baseRelativePath = buildGeneratedImagePath(
      imagesFolder,
      request.characterName,
      image.extension,
      new Date(),
      request.outputDirectory
    );
    const relativePath = await this.findAvailableRelativePath(project.path, baseRelativePath);
    const absolutePath = pathJoin(project.path, relativePath);
    await provider.download(image, absolutePath);
    return relativePath.replace(/\\/g, '/');
  }

  async listProjectImages(loadPreviews = true): Promise<ProjectImage[]> {
    const project = requireProject(this.projectService.getCurrentProject());
    const imagesRoot = this.projectService.getImagesFolderPath();
    if (!(await this.electronService.fileExists(imagesRoot))) return [];

    const scans = await Promise.all(
      IMAGE_PATTERNS.map((pattern) => this.electronService.readDirectoryRecursive(imagesRoot, pattern))
    );
    const byPath = new Map<string, ProjectImage>();
    for (const scan of scans) {
      for (const file of scan.files || []) {
        const insideImages = file.relativePath.replace(/\\/g, '/');
        const imagesFolder = project.metadata.settings.imagesFolder?.trim() || 'img';
        const relativePath = `${imagesFolder.replace(/^\/+|\/+$/g, '')}/${insideImages}`;
        byPath.set(relativePath, {
          relativePath,
          absolutePath: file.absolutePath,
        });
      }
    }

    const images = [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    if (loadPreviews) {
      await Promise.all(
        images.map(async (image) => {
          image.previewUrl = await this.electronService.getImageAsDataUrl(image.absolutePath);
        })
      );
    }
    return images;
  }

  async browseProjectImageDirectory(
    relativeDirectory = ''
  ): Promise<ProjectImageDirectory> {
    const project = requireProject(this.projectService.getCurrentProject());

    const normalizedDirectory = normalizeRelativeDirectory(relativeDirectory);
    const imagesRoot = this.projectService.getImagesFolderPath();
    const absoluteDirectory = normalizedDirectory
      ? pathJoin(imagesRoot, ...normalizedDirectory.split('/'))
      : imagesRoot;
    if (!(await this.electronService.fileExists(absoluteDirectory))) {
      return { relativeDirectory: normalizedDirectory, directories: [], images: [] };
    }

    const listing = await this.electronService.readDirectoryFiles(absoluteDirectory);
    if (!listing.success) {
      throw new Error(listing.error || 'Failed to read image directory');
    }

    const imagesFolder = project.metadata.settings.imagesFolder?.trim() || 'img';
    const root = imagesFolder.replace(/^\/+|\/+$/g, '') || 'img';
    const imageNames = (listing.files || [])
      .filter(isSupportedImageName)
      .sort((a, b) => a.localeCompare(b));
    const images = await Promise.all(
      imageNames.map(async (name): Promise<ProjectImage> => {
        const insideImages = normalizedDirectory ? `${normalizedDirectory}/${name}` : name;
        const absolutePath = pathJoin(absoluteDirectory, name);
        return {
          relativePath: `${root}/${insideImages}`,
          absolutePath,
          previewUrl: await this.electronService.getImageAsDataUrl(absolutePath),
        };
      })
    );

    const directoryNames = (listing.directories || []).sort((a, b) => a.localeCompare(b));
    const directories = await Promise.all(
      directoryNames.map(async (name) => {
        const absolutePath = pathJoin(absoluteDirectory, name);
        const childListing = await this.electronService.readDirectoryFiles(absolutePath);
        const previewName = (childListing.files || [])
          .filter(isSupportedImageName)
          .sort((a, b) => a.localeCompare(b))[0];
        return {
          name,
          previewUrl: previewName
            ? await this.electronService.getImageAsDataUrl(
                pathJoin(absolutePath, previewName)
              )
            : null,
        };
      })
    );

    return {
      relativeDirectory: normalizedDirectory,
      directories,
      images,
    };
  }

  private provider(overrides?: ImageGenerationSettings) {
    const settings = overrides || this.getSettings();
    switch (settings.provider) {
      case 'openai':
        return new OpenAiImageProvider(this.electronService, settings.openai || { apiKey: '' });
      case 'gemini':
        return new GeminiImageProvider(this.electronService, settings.gemini || { apiKey: '' });
      case 'comfyui': {
        const project = this.projectService.getCurrentProject();
        const workflowsDir = project ? pathJoin(project.path, COMFY_WORKFLOWS_DIR) : '';
        return new ComfyUiProvider(
          this.electronService,
          settings.comfyui?.baseUrl || defaultImageGenerationSettings().comfyui!.baseUrl,
          workflowsDir
        );
      }
      default:
        return new InvokeAiProvider(this.electronService, settings.invokeai.baseUrl);
    }
  }

  private async findAvailableWorkflowFilename(
    workflowsDir: string,
    requestedName: string
  ): Promise<string> {
    let candidate = requestedName;
    let suffix = 2;
    while (await this.electronService.fileExists(pathJoin(workflowsDir, candidate))) {
      const stem = requestedName.replace(/\.json$/i, '');
      candidate = `${stem}-${suffix}.json`;
      suffix += 1;
    }
    return candidate;
  }

  private async findAvailableRelativePath(projectPath: string, requestedPath: string): Promise<string> {
    let candidate = requestedPath;
    let suffix = 2;
    while (await this.electronService.fileExists(pathJoin(projectPath, candidate))) {
      const dot = requestedPath.lastIndexOf('.');
      candidate =
        dot > -1
          ? `${requestedPath.slice(0, dot)}-${suffix}${requestedPath.slice(dot)}`
          : `${requestedPath}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}

export function normalizeRelativeDirectory(relativeDirectory: string): string {
  const segments = (relativeDirectory || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error('Invalid image directory');
  }
  return segments.join('/');
}

function isSupportedImageName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function defaultImageGenerationSettings(): ImageGenerationSettings {
  return {
    enabled: false,
    provider: 'invokeai',
    invokeai: {
      baseUrl: 'http://invoke.yak-toad.ts.net',
    },
    comfyui: {
      baseUrl: 'http://127.0.0.1:8188',
    },
    openai: { apiKey: '' },
    gemini: { apiKey: '' },
  };
}

export function buildGeneratedImagePath(
  imagesFolder: string,
  characterName: string,
  extension: string,
  date: Date,
  directory?: string
): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const safeName = asciiSlugify(characterName) || 'character';
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const root = (directory ?? `${imagesFolder || 'img'}/@new`)
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
  return `${root}/${safeName}-${stamp}.${safeExtension}`;
}
