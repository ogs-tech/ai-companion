import type { McpHealth } from '../../../shared/mcp.js';

export type McpProbeState = 'connected' | 'needs-auth' | 'failed';

/** One line of the CLI's live MCP health check. `name` is the runtime (normalized) server name. */
export interface McpProbeResult {
  name: string;
  state: McpProbeState;
  detail?: string;
}

/** Asks the Claude Code runtime for the live connection state of every MCP server it knows. */
export interface McpProbePort {
  probe(): Promise<McpProbeResult[]>;
}

/**
 * A channel's own live MCP check, already in the renderer's vocabulary. Keyed by the server's name in that
 * channel's config (the `mcpServers` key). Servers the channel did not report are absent.
 */
export interface McpHealthProbePort {
  probe(): Promise<Map<string, McpHealth>>;
}
