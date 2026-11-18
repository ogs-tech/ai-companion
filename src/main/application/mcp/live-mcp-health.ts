import type { McpHealth } from '../../../shared/mcp.js';
import type { McpHealthProbePort } from '../ports/mcp-probe-port.js';

/**
 * The last live MCP check of one channel. Empty until the first `refresh()`. A failed probe (CLI missing,
 * timeout) or an inactive channel clears it: showing a stale "Conectado" would be worse than showing nothing.
 */
export class LiveMcpHealth {
  private last = new Map<string, McpHealth>();

  constructor(
    private readonly prober: McpHealthProbePort,
    private readonly isActive: () => Promise<boolean> = () => Promise.resolve(true),
  ) {}

  current(): ReadonlyMap<string, McpHealth> {
    return this.last;
  }

  async refresh(): Promise<void> {
    try {
      this.last = (await this.isActive()) ? await this.prober.probe() : new Map();
    } catch {
      this.last = new Map();
    }
  }
}
