import { describe, expect, it, vi } from 'vitest';
import { LiveMcpHealth } from '../../../../src/main/application/mcp/live-mcp-health.js';
import type { McpHealth } from '../../../../src/shared/mcp.js';

const reported = new Map<string, McpHealth>([['monday', { state: 'needs-auth' }]]);

describe('LiveMcpHealth', () => {
  it('keeps the last probe', async () => {
    const live = new LiveMcpHealth({ probe: async () => reported });
    expect(live.current().size).toBe(0);
    await live.refresh();
    expect(live.current().get('monday')).toEqual({ state: 'needs-auth' });
  });

  it('forgets it when the probe fails, rather than showing a stale state', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce(reported)
      .mockRejectedValueOnce(new Error('ENOENT'));
    const live = new LiveMcpHealth({ probe });
    await live.refresh();
    await live.refresh();
    expect(live.current().size).toBe(0);
  });

  it('does not run the CLI while the channel is off', async () => {
    const probe = vi.fn(async () => reported);
    const live = new LiveMcpHealth({ probe }, async () => false);
    await live.refresh();
    expect(probe).not.toHaveBeenCalled();
    expect(live.current().size).toBe(0);
  });
});
