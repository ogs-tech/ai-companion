import type { WorkspaceRegistryFile } from '../../../shared/workspace.js';
import type { WorkspaceRegistry } from '../../application/ports/workspace-registry.js';

export class InMemoryWorkspaceRegistry implements WorkspaceRegistry {
  private state: WorkspaceRegistryFile | null = null;

  load(): Promise<WorkspaceRegistryFile | null> {
    return Promise.resolve(this.state === null ? null : structuredClone(this.state));
  }

  save(file: WorkspaceRegistryFile): Promise<void> {
    this.state = structuredClone(file);
    return Promise.resolve();
  }
}
