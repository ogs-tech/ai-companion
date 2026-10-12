import { describe, it, expect, vi } from 'vitest';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { scopedRepository } from '../../helpers/scoped-repository.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../src/shared/entity.js';

const FROZEN = new Date('2026-04-26T10:00:00.000Z');
const skill = (name = 'demo'): Skill => ({
  urn: `urn:skill:${name}`, kind: 'skill', name, description: 'd', scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'b',
});

const workspaceSkill = (name = 'demo', scopeId = 'ws-1'): Skill => ({ ...skill(name), scopes: ['workspace'], scopeId });

const setup = (options: { workspaceId?: string } = {}) => {
  const { scoped: repo, global, workspace } = scopedRepository(options);
  const clock = new FixedClock(FROZEN);
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const service = new EntityService(repo, clock, adapterManager);
  return { repo, global, workspace, clock, service, adapterManager };
};

describe('EntityService.save', () => {
  it('stamps createdAt/updatedAt and syncs', async () => {
    const { service, adapterManager } = setup();
    const result = await service.save({ entity: skill(), isCreate: true });
    expect(result.entity.metadata.createdAt).toBe(FROZEN.toISOString());
    expect(result.entity.metadata.updatedAt).toBe(FROZEN.toISOString());
    expect(adapterManager.syncEntity).toHaveBeenCalledWith({ entity: result.entity });
  });

  it('preserves createdAt on update', async () => {
    const { service, clock } = setup();
    await service.save({ entity: skill(), isCreate: true });
    const later = new Date('2026-05-01T00:00:00.000Z');
    clock.set(later);
    const result = await service.save({ entity: skill() });
    expect(result.entity.metadata.createdAt).toBe(FROZEN.toISOString());
    expect(result.entity.metadata.updatedAt).toBe(later.toISOString());
  });

  it('rejects create when the urn already exists', async () => {
    const { service } = setup();
    await service.save({ entity: skill(), isCreate: true });
    await expect(service.save({ entity: skill(), isCreate: true })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('on rename removes the old entity symlinks then deletes it', async () => {
    const { service, repo, adapterManager } = setup();
    const created = (await service.save({ entity: skill('old'), isCreate: true })).entity as Skill;
    const renamed: Skill = { ...created, name: 'new' };
    await service.save({ entity: renamed });
    expect(adapterManager.removeEntity).toHaveBeenCalled();
    await expect(repo.get('urn:skill:old')).rejects.toMatchObject({ kind: 'not_found' });
    expect((await repo.get('urn:skill:new')).name).toBe('new');
  });

  it('rejects a rename onto an already-existing urn', async () => {
    const { service } = setup();
    const a = (await service.save({ entity: skill('a'), isCreate: true })).entity as Skill;
    await service.save({ entity: skill('b'), isCreate: true });
    // Rename `a` -> `b`: incoming urn still points at the old record, name is the taken one.
    const renamedOntoExisting: Skill = { ...a, name: 'b' };
    await expect(service.save({ entity: renamedOntoExisting })).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('EntityService — scope routing', () => {
  it('stores personal entities in Global and workspace entities in the open workspace', async () => {
    const { service, global, workspace } = setup({ workspaceId: 'ws-1' });
    await service.save({ entity: skill('mine'), isCreate: true });
    await service.save({ entity: workspaceSkill('local'), isCreate: true });
    expect((await global.list()).map((e) => e.name)).toEqual(['mine']);
    expect((await workspace!.list()).map((e) => e.name)).toEqual(['local']);
  });

  it('list returns Global ∪ the open workspace', async () => {
    const { service } = setup({ workspaceId: 'ws-1' });
    await service.save({ entity: skill('mine'), isCreate: true });
    await service.save({ entity: workspaceSkill('local'), isCreate: true });
    expect((await service.list('skill')).map((e) => e.name).sort()).toEqual(['local', 'mine']);
  });

  it('rejects a workspace entity when no workspace is open', async () => {
    const { service } = setup();
    await expect(service.save({ entity: workspaceSkill(), isCreate: true })).rejects.toMatchObject({
      kind: 'validation',
      details: { reason: 'no-active-workspace' },
    });
  });

  it('rejects a workspace entity whose scopeId is not the open workspace', async () => {
    const { service } = setup({ workspaceId: 'ws-1' });
    await expect(service.save({ entity: workspaceSkill('x', 'ws-2'), isCreate: true })).rejects.toMatchObject({
      kind: 'validation',
      details: { reason: 'scope-id-mismatch' },
    });
  });

  it('keeps names unique across Global and the workspace', async () => {
    const { service } = setup({ workspaceId: 'ws-1' });
    await service.save({ entity: skill('dup'), isCreate: true });
    await expect(service.save({ entity: workspaceSkill('dup'), isCreate: true })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('a scope change moves the file to the other store and removes the old destinations', async () => {
    const { service, global, workspace, adapterManager } = setup({ workspaceId: 'ws-1' });
    const saved = (await service.save({ entity: skill('mover'), isCreate: true })).entity as Skill;
    await service.save({ entity: { ...saved, scopes: ['workspace'], scopeId: 'ws-1' } });
    expect(await global.exists('urn:skill:mover')).toBe(false);
    expect((await workspace!.get('urn:skill:mover')).scopes).toEqual(['workspace']);
    expect(adapterManager.removeEntity).toHaveBeenCalledWith({ entity: expect.objectContaining({ scopes: ['personal'] }) });
  });
});

describe('EntityService.delete', () => {
  it('removes symlinks when asked', async () => {
    const { service, adapterManager } = setup();
    await service.save({ entity: skill(), isCreate: true });
    const result = await service.delete({ urn: 'urn:skill:demo', removeSymlinks: true });
    expect(result.ok).toBe(true);
    expect(adapterManager.removeEntity).toHaveBeenCalled();
  });

  it('does not call removeEntity when removeSymlinks is false', async () => {
    const { service, adapterManager } = setup();
    await service.save({ entity: skill(), isCreate: true });
    const result = await service.delete({ urn: 'urn:skill:demo', removeSymlinks: false });
    expect(result.ok).toBe(true);
    expect(result.syncReport).toBeUndefined();
    expect(adapterManager.removeEntity).not.toHaveBeenCalled();
  });
});

describe('EntityService.get / list', () => {
  it('returns saved entities via get and list', async () => {
    const { service } = setup();
    await service.save({ entity: skill(), isCreate: true });
    expect((await service.get('urn:skill:demo')).name).toBe('demo');
    const listed = await service.list('skill');
    expect(listed.map((e) => e.urn)).toContain('urn:skill:demo');
  });
});

describe('EntityService.filePath', () => {
  it('delegates to the repository', async () => {
    const { service } = setup();
    await service.save({ entity: skill(), isCreate: true });
    expect(await service.filePath('urn:skill:demo')).toBe('/in-memory/urn:skill:demo');
  });

  it('rejects not_found for a urn that does not exist', async () => {
    const { service } = setup();
    await expect(service.filePath('urn:skill:missing')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
