import type { ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../../application/ports/project-registry.js';

export class InMemoryProjectRegistry implements ProjectRegistry {
  private state: ProjectRegistryFile | null = null;

  load(): Promise<ProjectRegistryFile | null> {
    return Promise.resolve(this.state === null ? null : structuredClone(this.state));
  }

  save(file: ProjectRegistryFile): Promise<void> {
    this.state = structuredClone(file);
    return Promise.resolve();
  }
}
