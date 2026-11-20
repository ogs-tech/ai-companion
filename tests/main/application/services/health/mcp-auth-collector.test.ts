import { describe, expect, it } from 'vitest';
import { McpAuthCollector } from '../../../../../src/main/application/services/health/mcp-auth-collector.js';
import { FakeClaudeRuntimePort } from '../../../../../src/main/application/services/__fixtures__/fake-claude-runtime-port.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';

const FROZEN = new Date('2026-06-05T10:00:00.000Z');

const setup = () => {
  const runtime = new FakeClaudeRuntimePort();
  const collector = new McpAuthCollector(runtime, new FixedClock(FROZEN));
  return { runtime, collector };
};

describe('McpAuthCollector', () => {
  it('reports category mcp-auth', () => {
    const { collector } = setup();
    expect(collector.category).toBe('mcp-auth');
  });

  it('returns no checks when there are no auth alerts', async () => {
    const { collector } = setup();
    await expect(collector.collect()).resolves.toEqual([]);
  });

  it('emits one warning per server needing auth, with remediation and observedAt', async () => {
    const { runtime, collector } = setup();
    runtime.seedAuthAlerts([{ name: 'Gmail' }, { name: 'Google Calendar' }]);

    const checks = await collector.collect();

    expect(checks).toHaveLength(2);
    const first = checks[0]!;
    expect(first).toMatchObject({
      id: 'mcp-auth:Gmail',
      category: 'mcp-auth',
      severity: 'warning',
      cause: 'needs-auth',
      target: 'Gmail',
      remediation: 'Run /mcp in Claude Code to authenticate.',
      observedAt: FROZEN.toISOString(),
    });
    expect(first.title).toContain('Gmail');
  });

  it('puts a plugin server (`plugin:<id>:<server>`) on its own MCP row (the status report rolls it up to the plugin)', async () => {
    const { runtime, collector } = setup();
    runtime.seedAuthAlerts([{ name: 'plugin:figma:figma' }, { name: 'Gmail' }]);

    const checks = await collector.collect();

    expect(checks.map((c) => c.entityUrn)).toEqual(['urn:mcp:figma', 'urn:mcp:Gmail']);
    expect(checks[0]?.target).toBe('plugin:figma:figma');
  });
});
