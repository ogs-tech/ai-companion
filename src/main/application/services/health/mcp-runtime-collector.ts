import type { HealthCheck, Severity } from '../../../../shared/health.js';
import { entityUrn } from '../../../../shared/entity.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type {
  ClaudeRuntimePort,
  McpLogState,
  McpLogSummary,
} from '../../ports/claude-runtime-port.js';
import type { HealthCollector } from './health-collector.js';

const SEVERITY: Record<McpLogState, Severity> = {
  ok: 'ok',
  warning: 'warning',
  error: 'error',
};

export class McpRuntimeCollector implements HealthCollector {
  readonly category = 'mcp-runtime' as const;

  constructor(
    private readonly runtime: ClaudeRuntimePort,
    private readonly clock: ClockPort,
  ) {}

  // Global source: reads global MCP server config + runtime logs, which are not
  // scope-partitioned, so `scope` is intentionally omitted — see HealthCollector docs.
  async collect(): Promise<HealthCheck[]> {
    const [servers, logs] = await Promise.all([
      this.runtime.readMcpServers(),
      this.runtime.readMcpRuntimeLogs(),
    ]);

    const byServer = new Map<string, McpLogSummary>();
    for (const log of logs) byServer.set(log.server, log);

    const names = new Set<string>([
      ...servers.map((s) => s.name),
      ...logs.map((l) => l.server),
    ]);

    const observedAt = this.clock.now().toISOString();
    const checks: HealthCheck[] = [];
    for (const name of names) {
      const summary = byServer.get(name);
      const state: McpLogState = summary?.state ?? 'ok';
      const severity = SEVERITY[state];
      checks.push({
        id: `mcp-runtime:${name}`,
        category: 'mcp-runtime',
        severity,
        title:
          severity === 'ok' ? `MCP "${name}" healthy` : `MCP "${name}" runtime problem`,
        target: name,
        entityUrn: entityUrn('mcp', name),
        channel: 'claude',
        observedAt,
        ...(summary?.detail !== undefined ? { detail: summary.detail } : {}),
        ...(severity !== 'ok'
          ? { remediation: 'Check the MCP server logs and restart Claude Code.' }
          : {}),
      });
    }
    return checks;
  }
}
