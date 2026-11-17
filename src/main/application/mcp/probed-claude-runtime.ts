import type {
  ClaudeRuntimePort,
  McpAuthAlert,
  McpLogSummary,
  McpServerConfig,
} from '../ports/claude-runtime-port.js';
import type { McpProbePort, McpProbeResult } from '../ports/mcp-probe-port.js';

/**
 * Layers the CLI's live `mcp list` over the stale runtime files. The auth cache and the logs only change
 * when a `claude` session runs, so after the user connects a server elsewhere they keep saying "needs
 * auth". A probed server is authoritative until the next probe; servers the probe did not report fall
 * back to the files. Every consumer of the port (list, warnings, Diagnósticos) shares this one view.
 */
export class ProbedClaudeRuntime implements ClaudeRuntimePort {
  private probed = new Map<string, McpProbeResult>();

  constructor(
    private readonly files: ClaudeRuntimePort,
    private readonly prober: McpProbePort,
  ) {}

  async refresh(): Promise<void> {
    const results = await this.prober.probe();
    this.probed = new Map(results.map((r) => [r.name, r]));
  }

  readMcpServers(): Promise<McpServerConfig[]> {
    return this.files.readMcpServers();
  }

  async readMcpAuthAlerts(): Promise<McpAuthAlert[]> {
    const alerts = (await this.files.readMcpAuthAlerts()).filter((a) => !this.probed.has(a.name));
    const needsAuth = [...this.probed.values()].filter((r) => r.state === 'needs-auth').map((r) => ({ name: r.name }));
    return [...alerts, ...needsAuth];
  }

  async readMcpRuntimeLogs(): Promise<McpLogSummary[]> {
    const logs = (await this.files.readMcpRuntimeLogs()).filter((l) => !this.probed.has(l.server));
    const probedLogs: McpLogSummary[] = [...this.probed.values()]
      .filter((r) => r.state !== 'needs-auth')
      .map((r) => ({
        server: r.name,
        state: r.state === 'connected' ? 'ok' : 'error',
        ...(r.detail !== undefined ? { detail: r.detail } : {}),
      }));
    return [...logs, ...probedLogs];
  }
}
