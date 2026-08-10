import { SettingsSectionId } from './settings-section';

export interface SettingsFieldIndex {
  id: string;
  section: SettingsSectionId;
  label: string;
  keywords: string[];
  /** Keys used to resolve live values for search (section-specific). */
  valueKeys?: string[];
}

/** Static catalog of searchable settings fields (labels + keywords). Live values are resolved at query time. */
export const SETTINGS_FIELD_INDEX: SettingsFieldIndex[] = [
  {
    id: 'default-category',
    section: 'categories',
    label: 'Default Category',
    keywords: ['default category', 'pre-selected', 'new characters'],
    valueKeys: ['defaultCategory', 'defaultCategoryName'],
  },
  {
    id: 'zoom',
    section: 'appearance',
    label: 'Interface zoom',
    keywords: ['zoom', 'scale', 'magnify'],
    valueKeys: ['zoomPercent'],
  },
  {
    id: 'updates',
    section: 'general',
    label: 'Application Updates',
    keywords: ['update', 'version', 'check for updates'],
  },
  {
    id: 'characters-folder',
    section: 'general',
    label: 'Characters Folder',
    keywords: ['characters folder', 'path', 'directory'],
    valueKeys: ['charactersFolder'],
  },
  {
    id: 'casts-folder',
    section: 'general',
    label: 'Casts Folder',
    keywords: ['casts folder', 'path', 'directory'],
    valueKeys: ['castsFolder'],
  },
  {
    id: 'names-file',
    section: 'general',
    label: 'Names File',
    keywords: ['names file', 'backstage', 'names.md'],
    valueKeys: ['namesFile'],
  },
  {
    id: 'images-folder',
    section: 'general',
    label: 'Images Folder',
    keywords: ['images folder', 'portraits', 'img'],
    valueKeys: ['imagesFolder'],
  },
  {
    id: 'theme',
    section: 'appearance',
    label: 'Theme',
    keywords: ['theme', 'appearance', 'color scheme'],
    valueKeys: ['theme', 'themeName'],
  },
  {
    id: 'color-palette',
    section: 'appearance',
    label: 'Color Palette',
    keywords: ['color', 'palette', 'base colors', 'extra colors', 'theme override'],
    valueKeys: ['colorPaletteColors'],
  },
  {
    id: 'categories',
    section: 'categories',
    label: 'Categories',
    keywords: ['category', 'folder mode', 'auto', 'flat', 'custom folder'],
    valueKeys: ['categoryNames'],
  },
  {
    id: 'tags',
    section: 'tags',
    label: 'Tags',
    keywords: ['tag', 'labels'],
    valueKeys: ['tagNames'],
  },
  {
    id: 'character-styles',
    section: 'character-styles',
    label: 'Character Styles',
    keywords: ['style', 'portrait', 'anime', 'realistic', 'default style'],
    valueKeys: ['characterStyleNames', 'defaultCharacterStyle'],
  },
  {
    id: 'ai-enabled',
    section: 'ai',
    label: 'Enable AI Features',
    keywords: ['ai', 'enable', 'language model', 'ollama', 'lm studio'],
    valueKeys: ['aiEnabled'],
  },
  {
    id: 'ai-provider',
    section: 'ai',
    label: 'AI Provider',
    keywords: ['provider', 'ollama', 'lm studio', 'openai', 'anthropic'],
    valueKeys: ['aiProvider'],
  },
  {
    id: 'ai-server-url',
    section: 'ai',
    label: 'Server URL',
    keywords: ['server', 'url', 'localhost', 'endpoint'],
    valueKeys: ['aiServerUrl'],
  },
  {
    id: 'ai-model',
    section: 'ai',
    label: 'Model Name',
    keywords: ['model', 'llama', 'gpt'],
    valueKeys: ['aiModelName'],
  },
  {
    id: 'ai-api-key',
    section: 'ai',
    label: 'API Key',
    keywords: ['api key', 'token', 'secret'],
  },
  {
    id: 'ai-temperature',
    section: 'ai',
    label: 'Temperature',
    keywords: ['temperature', 'creativity', 'generation parameters'],
    valueKeys: ['aiTemperature'],
  },
  {
    id: 'ai-max-tokens',
    section: 'ai',
    label: 'Max Tokens',
    keywords: ['tokens', 'max tokens', 'length'],
    valueKeys: ['aiMaxTokens'],
  },
  {
    id: 'image-gen-enabled',
    section: 'image-generation',
    label: 'Enable character image generation',
    keywords: ['image generation', 'invokeai', 'comfyui', 'portrait', 'workflow'],
    valueKeys: ['imageGenEnabled'],
  },
  {
    id: 'invokeai-url',
    section: 'image-generation',
    label: 'InvokeAI Server URL',
    keywords: ['invokeai', 'server', 'url'],
    valueKeys: ['invokeAiBaseUrl'],
  },
  {
    id: 'comfyui-url',
    section: 'image-generation',
    label: 'ComfyUI Server URL',
    keywords: ['comfyui', 'comfy', 'server', 'url', 'workflow'],
    valueKeys: ['comfyUiBaseUrl'],
  },
  {
    id: 'default-workflow',
    section: 'image-generation',
    label: 'Default Workflow',
    keywords: ['workflow', 'preset', 'mangamaster'],
    valueKeys: ['defaultWorkflowId', 'comfyDefaultWorkflowId'],
  },
];
