/**
 * Which conversation of a harness's CLI a PTY should own, named by an id the
 * caller obtained up front ({@link SessionRuntimePort.newConversationId})
 * rather than one the CLI picks. `start` creates it, so the transcript is
 * known before the process even runs; `resume` reattaches to one that already
 * exists, whether it was started by this app minutes ago or in a plain
 * terminal last week.
 *
 * Naming the conversation replaces the old `--continue` ("attach to whatever
 * this cwd last talked to"), which could not tell two sessions sharing a cwd
 * apart.
 */
export interface ConversationTarget {
  mode: 'start' | 'resume';
  /** The harness's own id for the conversation (Claude: a UUID that is the transcript's basename; Cursor: a chat id). */
  conversationId: string;
}

export interface SessionSpawnOptions {
  cols: number;
  rows: number;
  conversation: ConversationTarget;
  /** Absolute path to an ephemeral `--mcp-config` file (embedded-browser tool), additive to the user's own MCP servers. Omitted when the session's browser tool isn't enabled. */
  mcpConfigPath?: string;
  /**
   * Extra project roots the CLI should load project customizations from, for a
   * session whose cwd is a helper directory that only *links* to the folders.
   * Ignored by a CLI that has no such flag.
   */
  addDirs?: readonly string[];
  /**
   * Absolute path of the session's signal file. Exposed to the CLI as
   * `AI_COMPANION_SIGNAL_FILE`; a CLI that takes hooks per invocation (Claude)
   * also gets its activity hooks injected.
   */
  signalFile?: string;
}

export type SessionDataListener = (sessionId: string, chunk: string) => void;
export type SessionExitListener = (sessionId: string, exitCode: number) => void;

/**
 * Spawns and controls a single interactive CLI process of one harness per
 * session, running in a real PTY so the CLI's TUI renders correctly.
 * `sessionId` is caller-assigned (SessionService uses the entity's urn) — the
 * port itself doesn't know about entities. One implementation per harness
 * with the `run` capability.
 */
export interface SessionRuntimePort {
  /** Whether the harness's CLI can be found and run on this machine. */
  isAvailable(): Promise<boolean>;
  /** Obtains the id of a brand-new conversation to hand to `spawn` with `mode: 'start'`. */
  newConversationId(cwd: string): Promise<string>;
  spawn(sessionId: string, cwd: string, opts: SessionSpawnOptions): Promise<void>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;
  onData(listener: SessionDataListener): void;
  onExit(listener: SessionExitListener): void;
}
