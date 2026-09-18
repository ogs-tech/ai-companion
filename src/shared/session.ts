export type SessionStatus = 'running' | 'exited';

export type SessionAnchor =
  | { kind: 'entity'; urn: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'project'; projectId: string };

export function sessionAnchorKey(anchor: SessionAnchor): string {
  if (anchor.kind === 'entity') return `entity:${anchor.urn}`;
  if (anchor.kind === 'workspace') return `workspace:${anchor.workspaceId}`;
  return `project:${anchor.projectId}`;
}

export interface SessionSnapshot {
  sessionId: string;
  /**
   * The conversation's id as the `claude` CLI knows it — always a UUID,
   * minted at spawn and handed to the CLI via `--session-id`, which makes the
   * CLI write its transcript to `~/.claude/projects/<slug>/<uuid>.jsonl`.
   *
   * Deliberately separate from `sessionId`, the app's own key: that one is
   * `sessionAnchorKey(anchor)` for entity anchors (`entity:urn:skill:foo`),
   * which is not a UUID and cannot be passed to the CLI. This field is the
   * exact join between a live session and its entry in the session history.
   */
  claudeSessionId: string;
  anchor: SessionAnchor;
  cwd: string;
  /** Human-readable name of the anchor (entity/workspace/project name), for display in a session list. */
  label: string;
  status: SessionStatus;
}

/**
 * A `SessionSnapshot` plus the scrollback captured so far — returned only by
 * `session.spawn`/`session.resume`/`session.status` (a single-session
 * lookup, used to replay output into a reattaching terminal), never by
 * `session.list` (an aggregate list of many sessions, where shipping every
 * buffer would be wasteful).
 */
export interface SessionSnapshotWithOutput extends SessionSnapshot {
  outputBuffer: string;
}

export interface SessionOutputEvent {
  sessionId: string;
  chunk: string;
}

export interface SessionExitEvent {
  sessionId: string;
  exitCode: number;
}

/** Push channel main→renderer for live PTY output (see docs/reference/ipc-contract.md#push-channels-exception-to-requestresponse). */
export const SESSION_OUTPUT_CHANNEL = 'session:output' as const;
/** Push channel main→renderer fired once when a session's `claude` process exits. */
export const SESSION_EXIT_CHANNEL = 'session:exit' as const;
