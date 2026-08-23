import { randomUUID } from 'node:crypto';
import type { Workspace, WorkspaceRegistryFile } from '../../../shared/workspace.js';
import { workspacePath } from '../../../shared/brand-paths.js';
import type { WorkspaceRegistry } from '../ports/workspace-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import { DomainError } from '../../domain/errors.js';

interface BootstrapPort {
  create(dataDir: string): Promise<void>;
}

export class WorkspaceService {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly clock: ClockPort,
    private readonly bootstrap: BootstrapPort,
    private readonly defaultRootPath: string,
  ) {}

  private async loadOrSeed(): Promise<WorkspaceRegistryFile> {
    const existing = await this.registry.load();
    if (existing !== null) return existing;

    await this.bootstrap.create(workspacePath(this.defaultRootPath));
    const seeded: WorkspaceRegistryFile = {
      workspaces: [
        {
          id: 'default',
          name: 'Default',
          rootPath: this.defaultRootPath,
          isDefault: true,
          createdAt: this.clock.now().toISOString(),
        },
      ],
      activeWorkspaceId: 'default',
    };
    await this.registry.save(seeded);
    return seeded;
  }

  async list(): Promise<Workspace[]> {
    const registry = await this.loadOrSeed();
    return registry.workspaces;
  }

  async get(id: string): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    const found = registry.workspaces.find((w) => w.id === id);
    if (!found) throw new DomainError('not_found', `Workspace not found: ${id}`);
    return found;
  }

  async getActive(): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    const active = registry.workspaces.find((w) => w.id === registry.activeWorkspaceId);
    if (active) return active;

    // activeWorkspaceId doesn't resolve to a known workspace (e.g. hand-edited
    // workspaces.json) — self-heal by falling back to the default workspace and
    // persisting the correction so subsequent calls don't need to fall back again.
    const fallback = registry.workspaces.find((w) => w.isDefault) ?? registry.workspaces[0];
    if (!fallback) throw new DomainError('not_found', 'No workspace available');

    await this.registry.save({ ...registry, activeWorkspaceId: fallback.id });
    return fallback;
  }

  async create(input: { name: string; rootPath: string }): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    await this.bootstrap.create(workspacePath(input.rootPath));
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      rootPath: input.rootPath,
      isDefault: false,
      createdAt: this.clock.now().toISOString(),
    };
    await this.registry.save({ ...registry, workspaces: [...registry.workspaces, workspace] });
    return workspace;
  }

  async switchTo(id: string): Promise<Workspace> {
    const registry = await this.loadOrSeed();
    const target = registry.workspaces.find((w) => w.id === id);
    if (!target) throw new DomainError('not_found', `Workspace not found: ${id}`);
    await this.registry.save({ ...registry, activeWorkspaceId: id });
    return target;
  }

  async delete(id: string): Promise<void> {
    const registry = await this.loadOrSeed();
    if (!registry.workspaces.some((w) => w.id === id)) {
      throw new DomainError('not_found', `Workspace not found: ${id}`);
    }
    if (registry.activeWorkspaceId === id) {
      throw new DomainError('validation', 'Cannot delete the active workspace — switch away first');
    }
    await this.registry.save({
      ...registry,
      workspaces: registry.workspaces.filter((w) => w.id !== id),
    });
  }
}
