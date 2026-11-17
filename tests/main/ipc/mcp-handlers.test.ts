import { describe, it, expect, vi } from 'vitest';
import { buildMcpHandlers } from '../../../src/main/ipc/mcp-handlers.js';
import type { McpService } from '../../../src/main/application/services/mcp-service.js';
import type { McpServer } from '../../../src/shared/mcp.js';

const server: McpServer = {
  id: 'id1',
  name: 'pencil',
  transport: 'stdio',
  def: { command: 'x' },
  scope: 'global',
  source: { kind: 'workspace' },
  enabled: true,
};

function fakeService(overrides: Partial<McpService> = {}): McpService {
  return {
    list: async () => [server],
    get: async () => server,
    ...overrides,
  } as unknown as McpService;
}

describe('mcp handlers', () => {
  it('mcp.list returns the servers', async () => {
    const handlers = buildMcpHandlers(fakeService());
    expect(await handlers['mcp.list']!(undefined)).toEqual([server]);
  });

  it('mcp.get validates id and returns the server', async () => {
    const handlers = buildMcpHandlers(fakeService());
    expect(await handlers['mcp.get']!({ id: 'id1' })).toEqual(server);
  });

  it('mcp.get rejects a missing id', async () => {
    const handlers = buildMcpHandlers(fakeService());
    await expect(handlers['mcp.get']!({})).rejects.toThrow();
  });

  it('mcp.save passes the server input through', async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    const handlers = buildMcpHandlers(fakeService({ save } as never));
    const input = { name: 'pencil', scope: 'global', def: { command: 'x' } };
    await handlers['mcp.save']!({ server: input, isCreate: true });
    expect(save).toHaveBeenCalledWith({ server: input, isCreate: true });
  });

  it('mcp.delete validates id', async () => {
    const handlers = buildMcpHandlers(fakeService());
    await expect(handlers['mcp.delete']!({})).rejects.toThrow();
  });

  it('mcp.authenticate validates id and delegates', async () => {
    const authenticate = vi.fn(async () => ({ ok: true as const }));
    const handlers = buildMcpHandlers(fakeService({ authenticate } as never));
    await handlers['mcp.authenticate']!({ id: 'id1' });
    expect(authenticate).toHaveBeenCalledWith({ id: 'id1' });
    await expect(handlers['mcp.authenticate']!({})).rejects.toThrow();
  });

  it('mcp.refreshHealth delegates', async () => {
    const refreshHealth = vi.fn(async () => ({ ok: true as const }));
    const handlers = buildMcpHandlers(fakeService({ refreshHealth } as never));
    await handlers['mcp.refreshHealth']!({});
    expect(refreshHealth).toHaveBeenCalledOnce();
  });
});
