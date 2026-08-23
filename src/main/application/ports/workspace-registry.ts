import type { WorkspaceRegistryFile } from '../../../shared/workspace.js';

export interface WorkspaceRegistry {
  load(): Promise<WorkspaceRegistryFile | null>;
  save(file: WorkspaceRegistryFile): Promise<void>;
}
