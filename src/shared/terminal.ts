export type TerminalStatus = 'running' | 'exited';

/** `shell` is an interactive login shell; `launch` runs a resolved `launch.json` command directly. */
export type TerminalKind = 'shell' | 'launch';

export interface TerminalSnapshot {
  terminalId: string;
  workspaceId: string;
  kind: TerminalKind;
  /** Shell name (`zsh`) for a shell terminal, the configuration name for a launch terminal. */
  name: string;
  /** Working directory relative to the workspace root; `''` is the root itself. */
  relCwd: string;
  status: TerminalStatus;
  exitCode: number | null;
  /** Bumped by every restart, so a view can tell the replay buffer it holds is stale. */
  generation: number;
}

/** A `TerminalSnapshot` plus the scrollback captured so far — returned only by `terminal.status`, never by `terminal.list`. */
export interface TerminalSnapshotWithOutput extends TerminalSnapshot {
  outputBuffer: string;
}

export interface TerminalOutputEvent {
  terminalId: string;
  chunk: string;
}

export interface TerminalExitEvent {
  terminalId: string;
  exitCode: number | null;
  // A signal name (e.g. 'SIGTERM'), typed as `string` rather than Node's own
  // `NodeJS.Signals` — this DTO also compiles under the renderer's web
  // tsconfig, which has no `node` types.
  signal: string | null;
}

/** Push channel main→renderer for live terminal output (mirrors session:output). */
export const TERMINAL_OUTPUT_CHANNEL = 'terminal:output' as const;
/** Push channel main→renderer fired when a terminal's process exits. */
export const TERMINAL_EXIT_CHANNEL = 'terminal:exit' as const;
