import { describe, it, expect, vi } from 'vitest';
import { WorkspaceService } from '../../../../src/main/application/services/workspace-service.js';
import { InMemoryWorkspaceRegistry } from '../../../../src/main/infrastructure/workspace/in-memory-workspace-registry.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { DomainError } from '../../../../src/main/domain/errors.js';
import type { DirectoryResolver } from '../../../../src/main/application/ports/directory-resolver.js';

/**
 * Directories that exist, keyed by every path that reaches them — an alias
 * entry stands in for a symlink (or a trailing slash) resolving to the same
 * real folder. Anything else is missing or not a directory.
 */
const DIRECTORIES: Record<string, string> = {
  '/home/u': '/home/u',
  '/home/u/': '/home/u',
  '/repos/acme': '/repos/acme',
  '/repos/acme/': '/repos/acme',
  '/links/acme': '/repos/acme',
  '/repos/acme/packages/api': '/repos/acme/packages/api',
  '/repos/bravo': '/repos/bravo',
};

const setup = () => {
  const registry = new InMemoryWorkspaceRegistry();
  const clock = new FixedClock(new Date('2026-08-22T10:00:00.000Z'));
  const bootstrap = { create: vi.fn().mockResolvedValue(undefined) };
  const directories: DirectoryResolver = { realDirectory: async (path) => DIRECTORIES[path] ?? null };
  const service = new WorkspaceService(registry, clock, bootstrap, '/home/u', directories);
  return { service, registry, bootstrap };
};

describe('WorkspaceService', () => {
  it('starts at Início: no workspaces, nothing active', async () => {
    const { service } = setup();
    expect(await service.list()).toEqual([]);
    expect(await service.getActive()).toBeNull();
  });

  describe('open', () => {
    it('registers a new folder (named after it), bootstraps its data dir and activates it', async () => {
      const { service, bootstrap } = setup();
      const opened = await service.open('/repos/acme');
      expect(opened).toMatchObject({ name: 'acme', rootPath: '/repos/acme', createdAt: '2026-08-22T10:00:00.000Z' });
      expect(bootstrap.create).toHaveBeenCalledWith('/repos/acme/.ai-companion');
      expect(await service.getActive()).toEqual(opened);
      expect(await service.list()).toEqual([opened]);
    });

    it('reuses the existing workspace for a folder already registered', async () => {
      const { service } = setup();
      const first = await service.open('/repos/acme');
      await service.goHome();
      const again = await service.open('/repos/acme');
      expect(again.id).toBe(first.id);
      expect(await service.list()).toHaveLength(1);
      expect((await service.getActive())?.id).toBe(first.id);
    });

    it('dedupes a symlinked or trailing-slash path to the same real folder', async () => {
      const { service } = setup();
      const first = await service.open('/repos/acme');
      expect((await service.open('/links/acme')).id).toBe(first.id);
      expect((await service.open('/repos/acme/')).id).toBe(first.id);
      expect(await service.list()).toHaveLength(1);
    });

    it('opens a folder nested inside another workspace as an independent workspace', async () => {
      const { service } = setup();
      const outer = await service.open('/repos/acme');
      const inner = await service.open('/repos/acme/packages/api');
      expect(inner.id).not.toBe(outer.id);
      expect(inner.rootPath).toBe('/repos/acme/packages/api');
      expect(await service.list()).toHaveLength(2);
    });

    it('rejects the home folder — that is Global, not a workspace', async () => {
      const { service } = setup();
      await expect(service.open('/home/u')).rejects.toMatchObject({ kind: 'validation', details: { reason: 'home-dir' } });
      await expect(service.open('/home/u/')).rejects.toMatchObject({ kind: 'validation' });
      expect(await service.list()).toEqual([]);
    });

    it('rejects a path that is not an existing directory', async () => {
      const { service } = setup();
      await expect(service.open('/repos/acme/README.md')).rejects.toMatchObject({
        kind: 'validation',
        details: { reason: 'not-a-directory' },
      });
    });
  });

  it('create registers a workspace without activating it', async () => {
    const { service, bootstrap } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/links/acme' });
    expect(created).toMatchObject({ name: 'Acme', rootPath: '/repos/acme' });
    expect(bootstrap.create).toHaveBeenCalledWith('/repos/acme/.ai-companion');
    expect(await service.getActive()).toBeNull();
  });

  it('create rejects a folder that already has a workspace', async () => {
    const { service } = setup();
    await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    await expect(service.create({ name: 'Again', rootPath: '/repos/acme/' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('switchTo activates an existing workspace and returns it', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    expect(await service.switchTo(created.id)).toEqual(created);
    expect((await service.getActive())?.id).toBe(created.id);
  });

  it('switchTo rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.switchTo('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('goHome clears the active workspace', async () => {
    const { service, registry } = setup();
    await service.open('/repos/acme');
    await service.goHome();
    expect(await service.getActive()).toBeNull();
    expect((await registry.load())?.activeWorkspaceId).toBeNull();
  });

  it('get rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.get('nope')).rejects.toBeInstanceOf(DomainError);
  });

  it('getActive self-heals a dangling activeWorkspaceId to Início', async () => {
    const { service, registry } = setup();
    await service.open('/repos/acme');
    const saved = await registry.load();
    if (saved === null) throw new Error('registry not written');
    await registry.save({ ...saved, activeWorkspaceId: 'ghost' });

    expect(await service.getActive()).toBeNull();
    expect((await registry.load())?.activeWorkspaceId).toBeNull();
  });

  it('delete unregisters a workspace that is not open', async () => {
    const { service } = setup();
    const acme = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    await service.delete(acme.id);
    expect(await service.list()).toEqual([]);
  });

  it('delete of the open workspace goes home', async () => {
    const { service } = setup();
    const acme = await service.open('/repos/acme');
    await service.delete(acme.id);
    expect(await service.getActive()).toBeNull();
    expect(await service.list()).toEqual([]);
  });

  it('delete rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.delete('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
