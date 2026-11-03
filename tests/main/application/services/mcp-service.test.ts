import { describe, expect, it, vi } from 'vitest';
import { McpService, type McpCanonical } from '../../../../src/main/application/services/mcp-service.js';
import { mcpServerId } from '../../../../src/main/domain/mcp-server-id.js';
import type { McpEntity } from '../../../../src/shared/entity.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';

const entity = (over: Partial<McpEntity> = {}): McpEntity => ({
  urn: 'urn:mcp:gh', kind: 'mcp', name: 'gh', description: '', scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: 't0', updatedAt: 't0' }, source: { kind: 'workspace' },
  def: { command: 'gh-mcp' }, enabled: true, ...over,
});

const detectedItem: DetectedEntity = {
  id: 'det-1', kind: 'mcp', name: 'fs', description: '', harness: 'cursor', scope: 'personal',
  path: '/home/u/.cursor/mcp.json', importable: true, preview: { def: { command: 'fs-mcp' } },
};

function make(opts: { canonical?: McpEntity[]; detected?: DetectedEntity[]; workspaceId?: string | null } = {}) {
  const store = new Map((opts.canonical ?? []).map((e) => [e.urn, e]));
  const save = vi.fn(async ({ entity: e }: { entity: McpEntity; isCreate?: boolean }) => {
    store.set(e.urn, e);
    return { entity: e, syncReport: [] };
  });
  const del = vi.fn(async () => ({ ok: true as const }));
  const canonical: McpCanonical = {
    entities: {
      list: async () => [...store.values()],
      get: async (urn: string) => {
        const found = store.get(urn);
        if (!found) throw new Error('not_found');
        return found;
      },
      save,
      delete: del,
    } as unknown as McpCanonical['entities'],
    detection: { list: async () => opts.detected ?? [] },
    workspaceId: opts.workspaceId === undefined ? 'ws-1' : opts.workspaceId,
  };
  const service = new McpService({
    canonical: () => canonical,
    plugins: { read: async () => [] } as never,
    runtime: { readMcpRuntimeLogs: async () => [], readMcpAuthAlerts: async () => [] } as never,
  });
  return { service, save, del };
}

describe('McpService (canonical layer)', () => {
  it('lists canonical and detected servers; detected rows are read-only and carry their import id', async () => {
    const { service } = make({ canonical: [entity()], detected: [detectedItem] });
    const list = await service.list();
    expect(list.find((s) => s.name === 'gh')).toMatchObject({ scope: 'global', source: { kind: 'workspace' }, enabled: true, transport: 'stdio' });
    expect(list.find((s) => s.name === 'fs')).toMatchObject({
      scope: 'detected',
      source: { kind: 'detected', detectedId: 'det-1', harness: 'cursor', importable: true },
    });
  });

  it('saves a global server as a personal entity', async () => {
    const { service, save } = make();
    await service.save({ server: { name: 'gh', scope: 'global', def: { command: 'gh-mcp' } }, isCreate: true });
    expect(save).toHaveBeenCalledWith({
      entity: expect.objectContaining({ kind: 'mcp', name: 'gh', scopes: ['personal'], enabled: true, def: { command: 'gh-mcp' } }),
      isCreate: true,
    });
  });

  it('saves a project server as a workspace entity bound to the open workspace and folder', async () => {
    const { service, save } = make();
    await service.save({ server: { name: 'p', scope: 'project-shared', repoPath: '/repos/app', def: { command: 'x' } }, isCreate: true });
    expect(save.mock.calls[0]![0].entity).toMatchObject({ scopes: ['workspace'], scopeId: 'ws-1', folder: '/repos/app' });
  });

  it('refuses a project server when no workspace is open, and an invalid def', async () => {
    const closed = make({ workspaceId: null });
    await expect(closed.service.save({ server: { name: 'p', scope: 'project-shared', repoPath: '/r', def: { command: 'x' } } })).rejects.toMatchObject({ kind: 'validation' });
    await expect(make().service.save({ server: { name: 'p', scope: 'global', def: { nope: 1 } } })).rejects.toThrow();
  });

  it('keeps the enabled flag when editing an existing server', async () => {
    const { service, save } = make({ canonical: [entity({ enabled: false })] });
    await service.save({ server: { name: 'gh', scope: 'global', def: { command: 'v2' } } });
    expect(save.mock.calls[0]![0].entity).toMatchObject({ enabled: false, def: { command: 'v2' } });
  });

  it('toggles enabled on the canonical entity (the sync removes/restores it in each harness)', async () => {
    const { service, save } = make({ canonical: [entity()] });
    await service.setEnabled({ id: mcpServerId({ location: { kind: 'global' }, name: 'gh' }), enabled: false });
    expect(save.mock.calls[0]![0].entity).toMatchObject({ name: 'gh', enabled: false });
  });

  it('deletes the canonical entity together with its harness entries', async () => {
    const { service, del } = make({ canonical: [entity()] });
    await service.delete({ id: mcpServerId({ location: { kind: 'global' }, name: 'gh' }) });
    expect(del).toHaveBeenCalledWith({ urn: 'urn:mcp:gh', removeSymlinks: true });
  });

  it('rejects mutating detected and plugin servers', async () => {
    const { service } = make();
    const detected = mcpServerId({ location: { kind: 'detected' }, name: 'cursor/personal/fs' });
    const plugin = mcpServerId({ location: { kind: 'plugin', pluginId: 'p', pluginDir: '/d' }, name: 'x' });
    await expect(service.delete({ id: detected })).rejects.toThrow(/import it first/);
    await expect(service.setEnabled({ id: plugin, enabled: false })).rejects.toThrow(/plugin/);
  });
});
