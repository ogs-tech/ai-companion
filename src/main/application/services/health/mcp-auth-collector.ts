import type { HealthCheck } from '../../../../shared/health.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type { ClaudeRuntimePort } from '../../ports/claude-runtime-port.js';
import type { HealthCollector } from './health-collector.js';
import { mcpCheckUrn } from './channel.js';

export class McpAuthCollector implements HealthCollector {
  readonly category = 'mcp-auth' as const;

  constructor(
    private readonly runtime: ClaudeRuntimePort,
    private readonly clock: ClockPort,
  ) {}

  // Global source: the MCP auth-needed cache is not scope-partitioned, so
  // `scope` is intentionally omitted — see HealthCollector docs.
  async collect(): Promise<HealthCheck[]> {
    const alerts = await this.runtime.readMcpAuthAlerts();
    const observedAt = this.clock.now().toISOString();
    return alerts.map((alert) => ({
      id: `mcp-auth:${alert.name}`,
      category: 'mcp-auth',
      severity: 'warning',
      title: `MCP "${alert.name}" needs authentication`,
      target: alert.name,
      entityUrn: mcpCheckUrn(alert.name),
      channel: 'claude',
      remediation: 'Run /mcp in Claude Code to authenticate.',
      observedAt,
    }));
  }
}
