import { describe, expect, it, vi } from 'vitest';
import {
  McpService,
  type McpCanonical,
} from '../../../../src/main/application/services/mcp-service.js';
import { mcpServerId } from '../../../../src/main/domain/mcp-server-id.js';
import type { McpEntity } from '../../../../src/shared/entity.js';
import type { DetectedEntity } from '../../../../src/shared/detected.js';
import type { McpHealth } from '../../../../src/shared/mcp.js';

const entity = (over: Partial<McpEntity> = {}): McpEntity => ({
  urn: 'urn:mcp:gh',
  kind: 'mcp',
  name: 'gh',
  description: '',
  scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: 't0', updatedAt: 't0' },
  source: { kind: 'workspace' },
  def: { command: 'gh-mcp' },
  enabled: true,
  ...over,
});

const detectedItem: DetectedEntity = {
  id: 'det-1',
  kind: 'mcp',
  name: 'fs',
  description: '',
  harness: 'cursor',
  scope: 'personal',
  path: '/home/u/.cursor/mcp.json',
  importable: true,
  preview: { def: { command: 'fs-mcp' } },
};

function make(
  opts: {
    canonical?: McpEntity[];
    detected?: DetectedEntity[];
    workspaceId?: string | null;
    pluginServers?: unknown[];
    authAlerts?: string[];
    cursorHealth?: Map<string, McpHealth>;
  } = {},
) {
  const store = new Map((opts.canonical ?? []).map((e) => [e.urn, e]));
  const save = vi.fn(async ({ entity: e }: { entity: McpEntity; isCreate?: boolean }) => {
    store.set(e.urn, e);
    return { entity: e, syncReport: [] };
  });
  const del = vi.fn(async () => ({ ok: true as const }));
  const cursorRefresh = vi.fn(async () => {});
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
    plugins: { read: async () => opts.pluginServers ?? [] } as never,
    runtime: {
      readMcpRuntimeLogs: async () => [],
      readMcpAuthAlerts: async () => (opts.authAlerts ?? []).map((name) => ({ name })),
    } as never,
    refreshHealth: async () => {},
    ...(opts.cursorHealth !== undefined
      ? { cursorHealth: { current: () => opts.cursorHealth!, refresh: cursorRefresh } }
      : {}),
  });
  return { service, save, del, cursorRefresh };
}

describe('McpService (canonical layer)', () => {
  it('lists canonical and detected servers; detected rows are read-only and carry their import id', async () => {
    const { service } = make({ canonical: [entity()], detected: [detectedItem] });
    const list = await service.list();
    expect(list.find((s) => s.name === 'gh')).toMatchObject({
      scope: 'global',
      source: { kind: 'workspace' },
      enabled: true,
      transport: 'stdio',
    });
    expect(list.find((s) => s.name === 'fs')).toMatchObject({
      scope: 'detected',
      source: { kind: 'detected', detectedId: 'det-1', harness: 'cursor', importable: true },
    });
  });

  it("carries Cursor's live state on its own servers and the ones detected in its config, not on Claude's", async () => {
    const claudeOnly: DetectedEntity = {
      ...detectedItem,
      id: 'det-2',
      name: 'gh-c',
      harness: 'claude',
      path: '/home/u/.claude.json',
    };
    const cursorHealth = new Map<string, McpHealth>([
      ['gh', { state: 'needs-auth' }],
      ['fs', { state: 'ok' }],
      ['gh-c', { state: 'ok' }],
    ]);
    const { service } = make({
      canonical: [entity()],
      detected: [detectedItem, claudeOnly],
      cursorHealth,
    });
    const list = await service.list();
    expect(list.find((s) => s.name === 'gh')?.channelHealth).toEqual({
      cursor: { state: 'needs-auth' },
    });
    expect(list.find((s) => s.name === 'fs')?.channelHealth).toEqual({ cursor: { state: 'ok' } });
    expect(list.find((s) => s.name === 'gh-c')?.channelHealth).toBeUndefined();
  });

  it('re-checks Cursor together with Claude', async () => {
    const { service, cursorRefresh } = make({ cursorHealth: new Map() });
    await service.refreshHealth();
    expect(cursorRefresh).toHaveBeenCalledOnce();
  });

  it('lists a plugin server once: a detected entry with the same name is dropped', async () => {
    const { service } = make({
      detected: [detectedItem],
      pluginServers: [
        {
          location: { kind: 'plugin', pluginId: 'p', pluginDir: '/d' },
          pluginId: 'p',
          name: 'fs',
          def: { command: 'fs' },
          provenance: {},
        },
      ],
    });
    const list = await service.list();
    expect(list.filter((s) => s.name === 'fs')).toHaveLength(1);
    expect(list.find((s) => s.name === 'fs')).toMatchObject({ scope: 'plugin' });
  });

  it('does not list a runtime-only `plugin:<plugin>:<server>` alert: plugin servers live under Plugins', async () => {
    const { service } = make({ authAlerts: ['plugin:marketing:amplitude'] });
    expect(await service.list()).toEqual([]);
  });

  it('does not list a plugin server again as an orphan when the runtime reports it as `plugin:<plugin>:<server>`', async () => {
    const { service } = make({
      authAlerts: ['plugin:marketing:amplitude'],
      pluginServers: [
        {
          location: { kind: 'plugin', pluginId: 'marketing', pluginDir: '/d' },
          pluginId: 'marketing',
          name: 'amplitude',
          def: { url: 'https://x' },
          provenance: 'claude-code',
        },
      ],
    });
    const list = await service.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'amplitude', health: { state: 'needs-auth' } });
  });

  it('lists a synced claude.ai plugin’s server once, as detected, with the health the runtime reports under its plugin name', async () => {
    const synced: DetectedEntity = {
      ...detectedItem,
      id: 'det-2',
      name: 'atlassian',
      harness: 'claude',
      plugin: 'design',
      preview: { def: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' } },
    };
    const { service } = make({ detected: [synced], authAlerts: ['plugin:design:atlassian'] });
    const list = await service.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'atlassian',
      scope: 'detected',
      source: { kind: 'detected', detectedId: 'det-2', importable: true },
      health: { state: 'needs-auth' },
    });
  });

  it('saves a global server as a personal entity', async () => {
    const { service, save } = make();
    await service.save({
      server: { name: 'gh', scope: 'global', def: { command: 'gh-mcp' } },
      isCreate: true,
    });
    expect(save).toHaveBeenCalledWith({
      entity: expect.objectContaining({
        kind: 'mcp',
        name: 'gh',
        scopes: ['personal'],
        enabled: true,
        def: { command: 'gh-mcp' },
      }),
      isCreate: true,
    });
  });

  it('saves a project server as a workspace entity bound to the open workspace and folder', async () => {
    const { service, save } = make();
    await service.save({
      server: { name: 'p', scope: 'project-shared', repoPath: '/repos/app', def: { command: 'x' } },
      isCreate: true,
    });
    expect(save.mock.calls[0]![0].entity).toMatchObject({
      scopes: ['workspace'],
      scopeId: 'ws-1',
      folder: '/repos/app',
    });
  });

  it('refuses a project server when no workspace is open, and an invalid def', async () => {
    const closed = make({ workspaceId: null });
    await expect(
      closed.service.save({
        server: { name: 'p', scope: 'project-shared', repoPath: '/r', def: { command: 'x' } },
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      make().service.save({ server: { name: 'p', scope: 'global', def: { nope: 1 } } }),
    ).rejects.toThrow();
  });

  it('keeps the enabled flag when editing an existing server', async () => {
    const { service, save } = make({ canonical: [entity({ enabled: false })] });
    await service.save({ server: { name: 'gh', scope: 'global', def: { command: 'v2' } } });
    expect(save.mock.calls[0]![0].entity).toMatchObject({ enabled: false, def: { command: 'v2' } });
  });

  it('deletes the canonical entity together with its harness entries', async () => {
    const { service, del } = make({ canonical: [entity()] });
    await service.delete({ id: mcpServerId({ location: { kind: 'global' }, name: 'gh' }) });
    expect(del).toHaveBeenCalledWith({ urn: 'urn:mcp:gh', removeSymlinks: true });
  });

  it('rejects mutating detected and plugin servers', async () => {
    const { service } = make();
    const detected = mcpServerId({ location: { kind: 'detected' }, name: 'cursor/personal/fs' });
    const plugin = mcpServerId({
      location: { kind: 'plugin', pluginId: 'p', pluginDir: '/d' },
      name: 'x',
    });
    await expect(service.delete({ id: detected })).rejects.toThrow(/import it first/);
    await expect(service.delete({ id: plugin })).rejects.toThrow(/plugin/);
  });
});
