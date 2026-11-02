import { describe, it, expect, vi } from 'vitest';
import { resolveScopePath } from '../../../src/main/application/resolve-scope-path.js';
import { DomainError } from '../../../src/main/domain/errors.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../src/shared/entity.js';

const base = {
  urn: 'urn:instruction:x', kind: 'instruction' as const, name: 'x', description: '',
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'x',
};

const unused = { workspaceService: { get: async () => { throw new Error('n/a'); } } };

describe('resolveScopePath', () => {
  it('resolves a workspace scope via workspaceService.get, called with the entity scopeId (not urn or anything else)', async () => {
    const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'ws-1' };
    const getSpy = vi.fn(async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', createdAt: '' }));
    expect(await resolveScopePath(entity, { workspaceService: { get: getSpy } })).toBe('/repos/ws');
    expect(getSpy).toHaveBeenCalledWith('ws-1');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('throws validation when scope is workspace but scopeId is missing', async () => {
    const entity: Instruction = { ...base, scopes: ['workspace'] };
    const err = await resolveScopePath(entity, unused).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('validation');
  });

  it('propagates not_found when the referenced workspace no longer exists', async () => {
    const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'gone' };
    const deps = { workspaceService: { get: async () => { throw new DomainError('not_found', 'Workspace not found: gone'); } } };
    await expect(resolveScopePath(entity, deps)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws internal for personal scope — callers must branch before calling this', async () => {
    const entity: Instruction = { ...base, scopes: ['personal'], name: 'default' };
    const err = await resolveScopePath(entity, unused).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('internal');
  });

  describe('multi-folder workspace', () => {
    const ws = { id: 'ws-1', name: 'W', rootPath: '/r/web', extraFolders: ['/r/api'], createdAt: '' };
    const deps = { workspaceService: { get: async () => ws }, homedir: '/home/u' };

    it('resolves to the entity folder when it lives in one', async () => {
      const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'ws-1', folder: '/r/api' };
      expect(await resolveScopePath(entity, deps)).toBe('/r/api');
    });

    it('resolves a shared entity (no folder) to the workspace home under Global', async () => {
      const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'ws-1' };
      expect(await resolveScopePath(entity, deps)).toBe('/home/u/.ai-companion/workspaces/ws-1');
    });

    it('a single-folder workspace still resolves to its root', async () => {
      const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'ws-1' };
      const single = { workspaceService: { get: async () => ({ id: ws.id, name: ws.name, rootPath: ws.rootPath, createdAt: '' }) }, homedir: '/home/u' };
      expect(await resolveScopePath(entity, single)).toBe('/r/web');
    });
  });
});
