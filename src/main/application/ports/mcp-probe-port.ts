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
