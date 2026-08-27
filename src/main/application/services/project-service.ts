import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import type { Project, ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../ports/project-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { SymlinkManager } from './symlink-manager.js';
import { projectIndexMarkerPath } from '../../../shared/brand-paths.js';
import { DomainError } from '../../domain/errors.js';

// Not entity-driven (Project isn't an Entity), so kept outside the AdapterManager pipeline.
export interface ProjectIndexMarkerDeps {
  symlinkManager: Pick<SymlinkManager, 'create' | 'removeIfPointsToWorkspace'>;
  sourcePath: string; // canonical <workspace dataDir>/index.md this marker symlinks to
  dataDir: string; // workspace .ai-companion dataDir — containment check for safe removal
}

export class ProjectService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly clock: ClockPort,
    private readonly indexMarker: ProjectIndexMarkerDeps,
  ) {}

  private async load(): Promise<ProjectRegistryFile> {
    return (await this.registry.load()) ?? { projects: [] };
  }

  async list(): Promise<Project[]> {
    return (await this.load()).projects;
  }

  async get(id: string): Promise<Project> {
    const found = (await this.load()).projects.find((p) => p.id === id);
    if (!found) throw new DomainError('not_found', `Project not found: ${id}`);
    return found;
  }

  async create(input: { name: string; path: string }): Promise<Project> {
    if (!isAbsolute(input.path)) {
      throw new DomainError('validation', `Project path must be absolute: ${input.path}`, {
        reason: 'relative-path',
      });
    }
    const registry = await this.load();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      createdAt: this.clock.now().toISOString(),
    };
    await this.registry.save({ projects: [...registry.projects, project] });
    await this.ensureIndexMarker(project.path);
    return project;
  }

  async update(input: { id: string; name?: string; path?: string }): Promise<Project> {
    if (input.path !== undefined && !isAbsolute(input.path)) {
      throw new DomainError('validation', `Project path must be absolute: ${input.path}`, {
        reason: 'relative-path',
      });
    }
    const registry = await this.load();
    const index = registry.projects.findIndex((p) => p.id === input.id);
    const current = index === -1 ? undefined : registry.projects[index];
    if (index === -1 || current === undefined) {
      throw new DomainError('not_found', `Project not found: ${input.id}`);
    }
    const updated: Project = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.path !== undefined ? { path: input.path } : {}),
    };
    const projects = [...registry.projects];
    projects[index] = updated;
    await this.registry.save({ projects });
    if (input.path !== undefined && input.path !== current.path) {
      await this.removeIndexMarker(current.path);
      await this.ensureIndexMarker(updated.path);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const registry = await this.load();
    const project = registry.projects.find((p) => p.id === id);
    if (!project) {
      throw new DomainError('not_found', `Project not found: ${id}`);
    }
    await this.registry.save({ projects: registry.projects.filter((p) => p.id !== id) });
    await this.removeIndexMarker(project.path);
  }

  async findOrCreateByPath(path: string): Promise<Project> {
    const existing = (await this.load()).projects.find((p) => p.path === path);
    if (existing) return existing;
    return this.create({ name: basename(path) || path, path });
  }

  // Best-effort: a failed marker symlink must not block project registration.
  private async ensureIndexMarker(projectPath: string): Promise<void> {
    try {
      await this.indexMarker.symlinkManager.create({
        source: this.indexMarker.sourcePath,
        destination: projectIndexMarkerPath(projectPath),
      });
    } catch {
      // best-effort — see doc comment above
    }
  }

  private async removeIndexMarker(projectPath: string): Promise<void> {
    try {
      await this.indexMarker.symlinkManager.removeIfPointsToWorkspace(
        projectIndexMarkerPath(projectPath),
        this.indexMarker.dataDir,
      );
    } catch {
      // best-effort — see ensureIndexMarker
    }
  }
}
