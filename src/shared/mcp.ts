import { CHANNELS, type ChannelId } from './channel.js';

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
  /** Claude's live state (`claude mcp list`, then its runtime files). */
  health?: McpHealth;
  /** Other channels' live state from their own CLI (`cursor-agent mcp list`); absent = not checked. */
  channelHealth?: Partial<Record<ChannelId, McpHealth>>;
}

/** True when a server can be re-authenticated via the external claude.ai flow. */
export function needsAuth(server: McpServer): boolean {
  return server.health?.state === 'needs-auth';
}

/**
 * Servers the Claude Code runtime owns itself — the built-in IDE integration (`ide`) and the
 * claude.ai connectors (`claude-ai-*`). They are not configured by the user, so a runtime
 * problem (IDE not connected, connector offline) is informational, never a warning.
 */
export function isClaudeManagedMcp(name: string): boolean {
  return name === 'ide' || name.startsWith('claude-ai-');
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

/** One channel an MCP server lives in, and the name that channel's CLI knows it by (`<bin> mcp login <loginName>`). */
export interface McpChannelTarget {
  channelId: ChannelId;
  loginName: string;
}

/** `claude-ai-Google-Drive` → `claude.ai Google Drive`: the runtime normalizes a connector's display name this way. */
function connectorLoginName(name: string): string {
  return `claude.ai ${name.slice('claude-ai-'.length).replace(/-/g, ' ')}`;
}

/**
 * The channels a server is configured in, among `enabled`, each with its login name. The app's own servers are
 * written to every channel that keeps MCP config; a plugin's server and a claude.ai connector exist only in Claude
 * (the runtime names them `plugin:<id>:<server>` / `claude.ai <name>`); a detected one only where it was found.
 */
export function mcpChannelTargets(server: McpServer, enabled: readonly ChannelId[]): McpChannelTarget[] {
  const keepsMcp = (id: ChannelId): boolean => enabled.includes(id) && CHANNELS[id].setup.mcpLogin !== null;
  const claudeName = server.name.startsWith('claude-ai-') ? connectorLoginName(server.name) : server.name;
  const { source } = server;
  if (source.kind === 'plugin') {
    return keepsMcp('claude') ? [{ channelId: 'claude', loginName: `plugin:${source.pluginId}:${server.name}` }] : [];
  }
  if (source.kind === 'detected') {
    // Found only in the Claude runtime (no file to read) when no harness is named.
    const harness = source.harness ?? 'claude';
    return keepsMcp(harness) ? [{ channelId: harness, loginName: harness === 'claude' ? claudeName : server.name }] : [];
  }
  return (Object.keys(CHANNELS) as ChannelId[])
    .filter(keepsMcp)
    .map((channelId) => ({ channelId, loginName: channelId === 'claude' ? claudeName : server.name }));
}

/** Whether signing in means anything: a remote server or a connector (OAuth). A stdio server reads its keys from `env`. */
export function mcpSignsIn(server: McpServer): boolean {
  return server.transport === 'http' || server.transport === 'sse' || server.name.startsWith('claude-ai-') || needsAuth(server);
}
