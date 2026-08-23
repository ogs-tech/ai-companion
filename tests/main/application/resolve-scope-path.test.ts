import { describe, it, expect } from 'vitest';
import { resolveScopePath } from '../../../src/main/application/resolve-scope-path.js';
import { DomainError } from '../../../src/main/domain/errors.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../src/shared/entity.js';

const base = {
  urn: 'urn:instruction:x', kind: 'instruction' as const, name: 'x', description: '',
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: 'x',
};

describe('resolveScopePath', () => {
  it('resolves a project scope via projectService.get', async () => {
    const entity: Instruction = { ...base, scopes: ['project'], scopeId: 'proj-1' };
    const deps = {
      workspaceService: { get: async () => { throw new Error('should not be called'); } },
      projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
    };
    expect(await resolveScopePath(entity, deps)).toBe('/repos/acme');
  });

  it('resolves a workspace scope via workspaceService.get', async () => {
    const entity: Instruction = { ...base, scopes: ['workspace'], scopeId: 'ws-1' };
    const deps = {
      workspaceService: { get: async (id: string) => ({ id, name: 'W', rootPath: '/repos/ws', isDefault: false, createdAt: '' }) },
      projectService: { get: async () => { throw new Error('should not be called'); } },
    };
    expect(await resolveScopePath(entity, deps)).toBe('/repos/ws');
  });

  it('throws validation when scope is project but scopeId is missing', async () => {
    const entity: Instruction = { ...base, scopes: ['project'] };
    const deps = { workspaceService: { get: async () => { throw new Error('n/a'); } }, projectService: { get: async () => { throw new Error('n/a'); } } };
    const err = await resolveScopePath(entity, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('validation');
  });

  it('propagates not_found when the referenced project no longer exists', async () => {
    const entity: Instruction = { ...base, scopes: ['project'], scopeId: 'gone' };
    const deps = {
      workspaceService: { get: async () => { throw new Error('n/a'); } },
      projectService: { get: async () => { throw new DomainError('not_found', 'Project not found: gone'); } },
    };
    await expect(resolveScopePath(entity, deps)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws internal for personal scope — callers must branch before calling this', async () => {
    const entity: Instruction = { ...base, scopes: ['personal'], name: 'default' };
    const deps = { workspaceService: { get: async () => { throw new Error('n/a'); } }, projectService: { get: async () => { throw new Error('n/a'); } } };
    const err = await resolveScopePath(entity, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).kind).toBe('internal');
  });
});
