import { describe, it, expect } from 'vitest';
import { buildAgentHandlers } from '../../../src/main/ipc/agent-handlers.js';
import type { AgentService } from '../../../src/main/application/services/agent-service.js';

function fakeService(overrides: Partial<AgentService> = {}): AgentService {
  return {
    resolvePath: async () => '/home/user/.ai-companion/agents/rev.md',
    ...overrides,
  } as unknown as AgentService;
}

describe('agent handlers', () => {
  it('agent.resolvePath returns the absolute path for the given id', async () => {
    const handlers = buildAgentHandlers(fakeService());
    expect(await handlers['agent.resolvePath']!({ id: 'rev' })).toEqual({
      absolutePath: '/home/user/.ai-companion/agents/rev.md',
    });
  });

  it('agent.resolvePath rejects a missing id', async () => {
    const handlers = buildAgentHandlers(fakeService());
    await expect(handlers['agent.resolvePath']!({})).rejects.toThrow();
  });
});
