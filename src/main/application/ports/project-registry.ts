import type { ProjectRegistryFile } from '../../../shared/project.js';

export interface ProjectRegistry {
  load(): Promise<ProjectRegistryFile | null>;
  save(file: ProjectRegistryFile): Promise<void>;
}
