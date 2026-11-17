import { describe, expect, it } from 'vitest';
import { ProbedClaudeRuntime } from '../../../../src/main/application/mcp/probed-claude-runtime.js';
import { FakeClaudeRuntimePort } from '../../../../src/main/application/services/__fixtures__/fake-claude-runtime-port.js';
import type { McpProbeResult } from '../../../../src/main/application/ports/mcp-probe-port.js';

function setup(results: McpProbeResult[]) {
  const files = new FakeClaudeRuntimePort();
  files.seedAuthAlerts([{ name: 'claude-ai-Gmail' }, { name: 'other' }]);
  files.seedRuntimeLogs([{ server: 'claude-ai-Gmail', state: 'error' }]);
  return { runtime: new ProbedClaudeRuntime(files, { probe: async () => results }) };
}

describe('ProbedClaudeRuntime', () => {
  it('reads the files untouched before any probe', async () => {
    const { runtime } = setup([{ name: 'claude-ai-Gmail', state: 'connected' }]);
    expect((await runtime.readMcpAuthAlerts()).map((a) => a.name)).toEqual(['claude-ai-Gmail', 'other']);
  });

  it('a connected probe clears the stale auth alert and error log', async () => {
    const { runtime } = setup([{ name: 'claude-ai-Gmail', state: 'connected' }]);
    await runtime.refresh();
    expect((await runtime.readMcpAuthAlerts()).map((a) => a.name)).toEqual(['other']);
    expect(await runtime.readMcpRuntimeLogs()).toEqual([{ server: 'claude-ai-Gmail', state: 'ok' }]);
  });

  it('a needs-auth probe adds an alert and a failed probe becomes an error log with detail', async () => {
    const { runtime } = setup([
      { name: 'figma', state: 'needs-auth' },
      { name: 'github', state: 'failed', detail: 'HTTP 400' },
    ]);
    await runtime.refresh();
    expect((await runtime.readMcpAuthAlerts()).map((a) => a.name)).toEqual(['claude-ai-Gmail', 'other', 'figma']);
    expect(await runtime.readMcpRuntimeLogs()).toContainEqual({ server: 'github', state: 'error', detail: 'HTTP 400' });
  });
});
