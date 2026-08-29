export interface ClaudeSessionSpawnOptions {
  cols: number;
  rows: number;
  /** Whether to try attaching to this cwd's prior `claude` conversation first (`--continue`), falling back to a fresh one if there isn't any. `false` skips that attempt entirely, for a session that must always start clean even when the cwd already has other conversations. */
  continueConversation: boolean;
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
