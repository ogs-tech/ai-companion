import { describe, expect, it, vi } from 'vitest';
import { buildChannelSetupHandlers } from '../../../src/main/ipc/channel-setup-handlers.js';
import type { ChannelSetupService } from '../../../src/main/application/services/channel-setup-service.js';

describe('channelSetup.mcpLogin', () => {
  it('validates the channel and the server name, then delegates', async () => {
    const startMcpLogin = vi.fn(async () => ({ kind: 'terminal' as const, terminalId: 't', title: 'x' }));
    const handlers = buildChannelSetupHandlers({ startMcpLogin } as unknown as ChannelSetupService);

    await handlers['channelSetup.mcpLogin']!({ channelId: 'claude', server: 'plugin:context7:context7' });

    expect(startMcpLogin).toHaveBeenCalledWith('claude', 'plugin:context7:context7');
    await expect(handlers['channelSetup.mcpLogin']!({ channelId: 'nope', server: 'x' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(handlers['channelSetup.mcpLogin']!({ channelId: 'claude' })).rejects.toMatchObject({ kind: 'validation' });
  });
});
