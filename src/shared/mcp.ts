export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpScope = 'global' | 'project-local' | 'project-shared' | 'plugin' | 'detected';
export type McpHealthState = 'ok' | 'warning' | 'error' | 'needs-auth';

export interface McpHealth {
  state: McpHealthState;
  detail?: string;
}

export type McpProvenance =
  | { kind: 'workspace' }
  | { kind: 'plugin'; pluginId: string; provenance: 'workspace-managed' | 'claude-code' }
  // Found in a harness's own files (or only in the Claude Code runtime): read-only until imported.
  | {
      kind: 'detected';
      /** Set for items found on disk; `mcp`/`detected.import` takes this id. */
      detectedId?: string;
      harness?: 'claude' | 'cursor';
      importable?: boolean;
      reason?: string;
    };

/** A server as shown in the renderer. `def` is the raw, passthrough-preserved definition. */
export interface McpServer {
  id: string;
  name: string;
  /** Absent for detected servers — the broker has no def to derive transport from. */
  transport?: McpTransport;
  def: Record<string, unknown>;
  scope: McpScope;
  repoPath?: string;
  source: McpProvenance;
  enabled: boolean;
  health?: McpHealth;
}

/** True when a server can be re-authenticated via the external claude.ai flow. */
export function needsAuth(server: McpServer): boolean {
  return server.health?.state === 'needs-auth';
}

/** Payload sent from the renderer to create/update a server (never plugin). */
export interface McpServerInput {
  id?: string;
  name: string;
  scope: 'global' | 'project-local' | 'project-shared';
  repoPath?: string;
  def: Record<string, unknown>;
}

export function isPluginMcp(server: McpServer): boolean {
  return server.source.kind === 'plugin';
}
