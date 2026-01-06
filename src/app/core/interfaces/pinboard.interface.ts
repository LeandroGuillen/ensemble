import { PinboardConnection, PinboardPin } from './project.interface';

// Re-export from project.interface to maintain backward compatibility
export type { PinboardConnection, PinboardPin } from './project.interface';

export interface PinboardData {
  nodes: PinboardPin[];
  edges: PinboardConnection[];
}

