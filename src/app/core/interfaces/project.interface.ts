export interface Pinboard {
  id: string;
  name: string;
  nodes: PinboardPin[];
  edges: PinboardConnection[];
  viewState?: PinboardViewState;
  createdAt?: string;
  updatedAt?: string;
}

/** Restored UI/session memory (routes, open boards, etc.); not user-facing settings. */
export interface ProjectLastSession {
  lastRoute?: string;
  /** Project-relative path to the open plot board file (*.plotboard.md). */
  lastPlotboardPath?: string;
  lastCharacterListFilterExpanded?: boolean;
  lastPlotBoardZoom?: number;
  /** Pinboard (relationship graph) the user had selected. */
  lastPinboardId?: string;
  /** Character style id selected on the character list page. */
  lastCharacterListStyle?: string;
}

/** Named portrait style (e.g. anime, realistic) for character thumbnails. */
export interface CharacterStyle {
  id: string;
  name: string;
}

export interface ProjectMetadata {
  projectName: string;
  version: string;
  categories: Category[];
  tags: Tag[];
  casts: Cast[];
  books: Book[];
  /** Ordered series shelves; optional for backward compatibility. */
  series?: Series[];
  /** Ordered sagas (each belongs to a series); optional for backward compatibility. */
  sagas?: Saga[];
  settings: ProjectSettings;
  pinboards?: Pinboard[];  // New: array of pinboards
  lastSession?: ProjectLastSession;
}

export interface PinboardConnection {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  color: string;
  labelColor?: string; // Optional: color for the label text (defaults to white with black outline)
  arrowFrom?: boolean; // Optional: arrow pointing from source
  arrowTo?: boolean;    // Optional: arrow pointing to target
}

export interface PinboardPin {
  id: string;
  name: string;
  position: { x: number; y: number };
  category?: string;
  color?: string;
}

export type CategoryFolderMode = 'flat' | 'auto' | 'specify';

export interface Category {
  id: string;
  name: string;
  color: string;
  description?: string;
  folderMode?: CategoryFolderMode;  // Default: 'auto' for backward compatibility
  folderPath?: string;              // Custom folder path, used when folderMode is 'specify'
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Cast {
  id: string;
  name: string;
  characterIds: string[];
  description?: string;      // Loaded from description.md in cast folder
  thumbnail?: string;         // Filename of thumbnail in cast folder
  folderPath?: string;        // Absolute path to cast folder
}

/** Grouping of books that tell a cohesive story (e.g. Harry Potter, Dragon Ball Super). */
export interface Series {
  id: string;
  name: string;
  description?: string;
  /** Accent color for shelf chrome on the Library page. */
  color?: string;
}

/** Sub-grouping of books within a series (e.g. Zamasu saga within Dragon Ball Super). */
export interface Saga {
  id: string;
  name: string;
  /** Parent series; required — a saga always belongs to a series. */
  seriesId: string;
  description?: string;
  color?: string;
}

export interface Book {
  id: string;
  /** Display title; stored as "Untitled" when not set. Either code or name must identify the book. */
  name: string;
  color: string;
  /** Short free-text identifier (e.g. "n23", "s99"). Unique when set. */
  code?: string;
  description?: string;
  status?: 'draft' | 'in-progress' | 'published' | 'archived';
  publicationDate?: string;
  isbn?: string;
  coverImage?: string;
  /** Character IDs that are PoV for this book (independent of category/tags). */
  povCharacterIds?: string[];
  /** Optional series membership (Library grouping). */
  seriesId?: string;
  /** Optional saga membership; when set, seriesId must match the saga's series. */
  sagaId?: string;
}

export interface AiSettings {
  enabled: boolean;
  provider: 'ollama' | 'lm-studio' | 'openai' | 'anthropic';
  // Ollama/LM Studio settings
  localServerUrl: string;
  modelName: string;
  // Cloud API settings (optional)
  apiKey?: string;
  // Generation parameters
  temperature: number;
  maxTokens: number;
}

export type ImageGenerationProviderId = 'invokeai' | 'openai' | 'gemini';

export interface CloudImageSettings {
  apiKey: string;
  /** Provider model id; falls back to the provider's default when omitted. */
  model?: string;
}

export interface InvokeAiImageSettings {
  baseUrl: string;
  defaultWorkflowId?: string;
}

export interface ImageGenerationSettings {
  enabled: boolean;
  provider: ImageGenerationProviderId;
  invokeai: InvokeAiImageSettings;
  openai?: CloudImageSettings;
  gemini?: CloudImageSettings;
}

export interface ProjectSettings {
  defaultCategory: string;
  /** Relative path from project root for character files (default: 'characters') */
  charactersFolder?: string;
  /** Relative path from project root for the casts folder (default: 'characters/casts') */
  castsFolder?: string;
  /** Relative path from project root for the names/list file (default: 'characters/names.md') */
  namesFile?: string;
  /** Relative path from project root containing project images (default: 'img') */
  imagesFolder?: string;
  /** Available character portrait styles for this project */
  characterStyles?: CharacterStyle[];
  /** Default character style id (used by pinboard, casts, character detail hero) */
  defaultCharacterStyle?: string;
  pinboardView?: PinboardViewState;
  ai?: AiSettings;
  imageGeneration?: ImageGenerationSettings;
  theme?: string; // Theme ID (e.g., "blue-gold")
  colorPalette?: import('./color-palette.interface').ColorPaletteConfig;
}

export interface PinboardViewState {
  zoomIndex: number;
  viewPosition: { x: number; y: number };
  showGrid?: boolean;
  snapToGrid?: boolean;
}

export interface Project {
  path: string;
  metadata: ProjectMetadata;
}