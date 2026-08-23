import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Project, ProjectRegistryFile } from '../../../shared/project.js';
import type { ProjectRegistry } from '../ports/project-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import { DomainError } from '../../domain/errors.js';

export class ProjectService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly clock: ClockPort,
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
    const registry = await this.load();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      createdAt: this.clock.now().toISOString(),
    };
    await this.registry.save({ projects: [...registry.projects, project] });
    return project;
  }

  async update(input: { id: string; name?: string; path?: string }): Promise<Project> {
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
    return updated;
  }

  async delete(id: string): Promise<void> {
    const registry = await this.load();
    if (!registry.projects.some((p) => p.id === id)) {
      throw new DomainError('not_found', `Project not found: ${id}`);
    }
    await this.registry.save({ projects: registry.projects.filter((p) => p.id !== id) });
  }

  async findOrCreateByPath(path: string): Promise<Project> {
    const existing = (await this.load()).projects.find((p) => p.path === path);
    if (existing) return existing;
    return this.create({ name: basename(path) || path, path });
  }
}
