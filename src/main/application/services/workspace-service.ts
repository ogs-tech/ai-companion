import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Workspace, WorkspaceRegistryFile } from '../../../shared/workspace.js';
import { WORKSPACE_REGISTRY_SCHEMA_VERSION } from '../../../shared/workspace.js';
import { workspacePath } from '../../../shared/brand-paths.js';
import type { WorkspaceRegistry } from '../ports/workspace-registry.js';
import type { ClockPort } from '../ports/clock-port.js';
import type { DirectoryResolver } from '../ports/directory-resolver.js';
import { DomainError } from '../../domain/errors.js';

interface BootstrapPort {
  create(dataDir: string): Promise<void>;
}

/**
 * The workspace registry (`~/.ai-companion/workspaces.json`). A workspace is
 * any folder except the home dir — that one is Global, which is not a
 * workspace. `activeWorkspaceId === null` means Global (Início) is showing.
 *
 * Every root is stored as its real path, so the same folder reached through a
 * symlink or with a trailing slash is one workspace, not two.
 */
export class WorkspaceService {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly clock: ClockPort,
    private readonly bootstrap: BootstrapPort,
    private readonly homedir: string,
    private readonly directories: DirectoryResolver,
  ) {}

  private async load(): Promise<WorkspaceRegistryFile> {
    return (
      (await this.registry.load()) ?? {
        schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION,
        workspaces: [],
        activeWorkspaceId: null,
      }
    );
  }

  async list(): Promise<Workspace[]> {
    return (await this.load()).workspaces;
  }

  async get(id: string): Promise<Workspace> {
    const found = (await this.load()).workspaces.find((w) => w.id === id);
    if (!found) throw new DomainError('not_found', `Workspace not found: ${id}`);
    return found;
  }

  /** The open workspace, or `null` at Início. A dangling id (hand-edited file) self-heals to `null`. */
  async getActive(): Promise<Workspace | null> {
    const registry = await this.load();
    if (registry.activeWorkspaceId === null) return null;
    const active = registry.workspaces.find((w) => w.id === registry.activeWorkspaceId);
    if (active) return active;
    await this.registry.save({ ...registry, activeWorkspaceId: null });
    return null;
  }

  /** Registers a folder under a chosen name, without opening it. */
  async create(input: { name: string; rootPath: string }): Promise<Workspace> {
    const rootPath = await this.resolveRoot(input.rootPath);
    const registry = await this.load();
    if (registry.workspaces.some((w) => w.rootPath === rootPath)) {
      throw new DomainError('validation', `A workspace already exists for ${rootPath}`, {
        reason: 'duplicate-root',
        conflict: rootPath,
      });
    }
    return this.register(registry, input.name, rootPath);
  }

  /** Opens a folder as a workspace — the existing one for that folder, or a new one named after it. */
  async open(path: string): Promise<Workspace> {
    const rootPath = await this.resolveRoot(path);
    const registry = await this.load();
    const existing = registry.workspaces.find((w) => w.rootPath === rootPath);
    if (existing) {
      await this.bootstrap.create(workspacePath(existing.rootPath));
      return this.activate(registry, existing);
    }
    const created = await this.register(registry, basename(rootPath) || rootPath, rootPath);
    return this.activate(await this.load(), created);
  }

  async switchTo(id: string): Promise<Workspace> {
    const registry = await this.load();
    const target = registry.workspaces.find((w) => w.id === id);
    if (!target) throw new DomainError('not_found', `Workspace not found: ${id}`);
    return this.activate(registry, target);
  }

  async goHome(): Promise<void> {
    const registry = await this.load();
    if (registry.activeWorkspaceId === null) return;
    await this.registry.save({ ...registry, activeWorkspaceId: null });
  }

  /** Unregisters a workspace — its folder and data dir stay on disk. Deleting the open one goes home. */
  async delete(id: string): Promise<void> {
    const registry = await this.load();
    if (!registry.workspaces.some((w) => w.id === id)) {
      throw new DomainError('not_found', `Workspace not found: ${id}`);
    }
    await this.registry.save({
      ...registry,
      workspaces: registry.workspaces.filter((w) => w.id !== id),
      activeWorkspaceId: registry.activeWorkspaceId === id ? null : registry.activeWorkspaceId,
    });
  }

  /** Makes `target` the open workspace, stamping `lastOpenedAt` (what the switcher's "Recentes" sorts by). */
  private async activate(registry: WorkspaceRegistryFile, target: Workspace): Promise<Workspace> {
    const opened: Workspace = { ...target, lastOpenedAt: this.clock.now().toISOString() };
    await this.registry.save({
      ...registry,
      workspaces: registry.workspaces.map((w) => (w.id === opened.id ? opened : w)),
      activeWorkspaceId: opened.id,
    });
    return opened;
  }

  private async register(registry: WorkspaceRegistryFile, name: string, rootPath: string): Promise<Workspace> {
    await this.bootstrap.create(workspacePath(rootPath));
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      rootPath,
      createdAt: this.clock.now().toISOString(),
    };
    await this.registry.save({ ...registry, workspaces: [...registry.workspaces, workspace] });
    return workspace;
  }

  private async resolveRoot(path: string): Promise<string> {
    const rootPath = await this.directories.realDirectory(path);
    if (rootPath === null) {
      throw new DomainError('validation', `Not an existing directory: ${path}`, { reason: 'not-a-directory' });
    }
    const home = (await this.directories.realDirectory(this.homedir)) ?? this.homedir;
    if (rootPath === home) {
      throw new DomainError('validation', 'The home folder is Global (Início), not a workspace', {
        reason: 'home-dir',
      });
    }
    return rootPath;
  }
}
