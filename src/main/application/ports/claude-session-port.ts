/**
 * Which `claude` conversation a PTY should own, named by a UUID the caller
 * mints rather than one the CLI picks. `start` creates it (`--session-id`),
 * so the transcript's filename is known before the process even runs;
 * `resume` reattaches to one that already exists (`--resume`), whether it was
 * started by this app minutes ago or in a plain terminal last week.
 *
 * This replaces the old `--continue` ("attach to whatever this cwd last
 * talked to"), which could not tell two sessions sharing a cwd apart.
 */
export interface ClaudeConversationTarget {
  mode: 'start' | 'resume';
  /** A UUID. Doubles as the basename of the CLI's transcript for this conversation. */
  claudeSessionId: string;
}

export interface ClaudeSessionSpawnOptions {
  cols: number;
  rows: number;
  conversation: ClaudeConversationTarget;
  /** Absolute path to an ephemeral `--mcp-config` file (embedded-browser tool), additive to the user's own MCP servers. Omitted when the session's browser tool isn't enabled. */
  mcpConfigPath?: string;
}

export type ClaudeSessionDataListener = (sessionId: string, chunk: string) => void;
export type ClaudeSessionExitListener = (sessionId: string, exitCode: number) => void;

/**
 * Spawns and controls a single interactive `claude` CLI process per session,
 * running in a real PTY so the CLI's TUI renders correctly. `sessionId` is
 * caller-assigned (SessionService uses the entity's urn) — the port itself
 * doesn't know about entities.
 */
export interface ClaudeSessionPort {
  spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
  onData(listener: ClaudeSessionDataListener): void;
  onExit(listener: ClaudeSessionExitListener): void;
}
