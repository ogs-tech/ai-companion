import { describe, it, expect, vi } from 'vitest';
import { WorkspaceService } from '../../../../src/main/application/services/workspace-service.js';
import { InMemoryWorkspaceRegistry } from '../../../../src/main/infrastructure/workspace/in-memory-workspace-registry.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const setup = () => {
  const registry = new InMemoryWorkspaceRegistry();
  const clock = new FixedClock(new Date('2026-08-22T10:00:00.000Z'));
  const bootstrap = { create: vi.fn().mockResolvedValue(undefined) };
  const service = new WorkspaceService(registry, clock, bootstrap, '/home/u');
  return { service, registry, bootstrap };
};

describe('WorkspaceService', () => {
  it('seeds the default workspace on first list() and bootstraps its data dir', async () => {
    const { service, bootstrap } = setup();
    const list = await service.list();
    expect(list).toEqual([
      { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '2026-08-22T10:00:00.000Z' },
    ]);
    expect(bootstrap.create).toHaveBeenCalledWith('/home/u/.ai-companion');
  });

  it('getActive returns the default workspace on first run', async () => {
    const { service } = setup();
    expect(await service.getActive()).toMatchObject({ id: 'default', isDefault: true });
  });

  it('seeding is idempotent across repeated calls', async () => {
    const { service, registry } = setup();
    await service.list();
    await service.list();
    const loaded = await registry.load();
    expect(loaded?.workspaces).toHaveLength(1);
  });

  it('create adds a new workspace, bootstraps it, and does not change the active one', async () => {
    const { service, bootstrap } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    expect(created).toMatchObject({ name: 'Acme', rootPath: '/repos/acme', isDefault: false });
    expect(typeof created.id).toBe('string');
    expect(bootstrap.create).toHaveBeenCalledWith('/repos/acme/.ai-companion');
    expect((await service.getActive()).id).toBe('default');
    expect(await service.list()).toHaveLength(2);
  });

  it('switchTo updates the active workspace id and returns it', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    const active = await service.switchTo(created.id);
    expect(active).toEqual(created);
    expect((await service.getActive()).id).toBe(created.id);
  });

  it('switchTo rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.switchTo('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('get rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.get('nope')).rejects.toBeInstanceOf(DomainError);
  });

  it('getActive falls back to the default workspace and repairs the registry when activeWorkspaceId does not resolve', async () => {
    const { service, registry } = setup();
    await service.list();
    const seeded = await registry.load();
    await registry.save({ ...seeded!, activeWorkspaceId: 'ghost' });

    const active = await service.getActive();
    expect(active).toMatchObject({ id: 'default', isDefault: true });

    const repaired = await registry.load();
    expect(repaired?.activeWorkspaceId).toBe('default');
    expect(await service.getActive()).toMatchObject({ id: 'default', isDefault: true });
  });

  it('delete removes a non-active workspace', async () => {
    const { service } = setup();
    const created = await service.create({ name: 'Acme', rootPath: '/repos/acme' });
    await service.delete(created.id);
    expect(await service.list()).toHaveLength(1);
  });

  it('delete rejects deleting the active workspace with validation', async () => {
    const { service } = setup();
    await expect(service.delete('default')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('delete rejects an unknown id with not_found', async () => {
    const { service } = setup();
    await expect(service.delete('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
