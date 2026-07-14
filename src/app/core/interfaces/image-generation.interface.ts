export interface ImageWorkflow {
  id: string;
  name: string;
  description?: string;
  positivePromptField: WorkflowFieldIdentifier;
  negativePromptField: WorkflowFieldIdentifier;
  /** Fixed prefix from a String Join or template string node in the InvokeAI workflow. */
  positivePromptTemplate?: string;
  negativePromptTemplate?: string;
}

export interface WorkflowFieldIdentifier {
  nodeId: string;
  fieldName: string;
}

export interface ImageGenerationRequest {
  workflowId: string;
  positivePrompt: string;
  negativePrompt: string;
  characterName: string;
}

export interface GeneratedImage {
  providerImageName: string;
  contentType: string;
  extension: string;
}

export interface ProjectImage {
  relativePath: string;
  absolutePath: string;
  previewUrl?: string | null;
}

export interface ProjectImageDirectory {
  relativeDirectory: string;
  directories: ProjectImageFolder[];
  images: ProjectImage[];
}

export interface ProjectImageFolder {
  name: string;
  previewUrl?: string | null;
}

export interface ImageGenerationProvider {
  testConnection(): Promise<{ success: boolean; error?: string; version?: string }>;
  listWorkflows(): Promise<ImageWorkflow[]>;
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>;
  download(image: GeneratedImage, destinationPath: string): Promise<void>;
}
