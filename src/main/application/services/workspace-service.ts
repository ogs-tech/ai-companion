import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Workspace, WorkspaceRegistryFile } from '../../../shared/workspace.js';
import { WORKSPACE_REGISTRY_SCHEMA_VERSION, workspaceFolders } from '../../../shared/workspace.js';
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
 * Every folder is stored as its real path, so the same folder reached through a
 * symlink or with a trailing slash is one workspace, not two.
 */
/** The workspace that holds `folder` (a real path) among its folders, if any. */
function findOwner(registry: WorkspaceRegistryFile, folder: string): Workspace | undefined {
  return registry.workspaces.find((w) => workspaceFolders(w).includes(folder));
}

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
    if (findOwner(registry, rootPath)) {
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
    const existing = findOwner(registry, rootPath);
    if (existing) {
      await this.bootstrap.create(workspacePath(existing.rootPath));
      return this.activate(registry, existing);
    }
    const created = await this.register(registry, basename(rootPath) || rootPath, rootPath);
    return this.activate(await this.load(), created);
  }

  /**
   * Adds a folder to a workspace. One folder, one workspace: a folder already
   * used by any workspace is refused, naming that workspace.
   */
  async addFolder(id: string, path: string): Promise<Workspace> {
    const folder = await this.resolveRoot(path);
    const registry = await this.load();
    const target = registry.workspaces.find((w) => w.id === id);
    if (!target) throw new DomainError('not_found', `Workspace not found: ${id}`);
    const owner = findOwner(registry, folder);
    if (owner) {
      throw new DomainError('validation', `${folder} already belongs to workspace "${owner.name}"`, {
        reason: owner.id === id ? 'already-in-workspace' : 'folder-in-other-workspace',
        conflict: folder,
        workspaceId: owner.id,
        workspaceName: owner.name,
      });
    }
    await this.bootstrap.create(workspacePath(folder));
    return this.update(registry, { ...target, extraFolders: [...(target.extraFolders ?? []), folder] });
  }

  /**
   * Removes a folder from a workspace. Never touches disk — the folder and its
   * `.ai-companion/` stay. The last folder cannot go (delete the workspace
   * instead); removing the primary promotes the next folder to `rootPath`.
   */
  async removeFolder(id: string, path: string): Promise<Workspace> {
    const registry = await this.load();
    const target = registry.workspaces.find((w) => w.id === id);
    if (!target) throw new DomainError('not_found', `Workspace not found: ${id}`);
    const folder = (await this.directories.realDirectory(path)) ?? path;
    const folders = workspaceFolders(target);
    if (!folders.includes(folder)) {
      throw new DomainError('not_found', `${folder} is not a folder of workspace "${target.name}"`);
    }
    if (folders.length === 1) {
      throw new DomainError('validation', 'A workspace needs at least one folder', { reason: 'last-folder' });
    }
    const [rootPath, ...extra] = folders.filter((f) => f !== folder) as [string, ...string[]];
    const { extraFolders: _drop, ...rest } = target;
    return this.update(registry, extra.length > 0 ? { ...rest, rootPath, extraFolders: extra } : { ...rest, rootPath });
  }

  async rename(id: string, name: string): Promise<Workspace> {
    const trimmed = name.trim();
    if (trimmed === '') throw new DomainError('validation', 'Workspace name is required', { reason: 'empty-name' });
    const registry = await this.load();
    const target = registry.workspaces.find((w) => w.id === id);
    if (!target) throw new DomainError('not_found', `Workspace not found: ${id}`);
    return this.update(registry, { ...target, name: trimmed });
  }

  private async update(registry: WorkspaceRegistryFile, next: Workspace): Promise<Workspace> {
    await this.registry.save({
      ...registry,
      workspaces: registry.workspaces.map((w) => (w.id === next.id ? next : w)),
    });
    return next;
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
