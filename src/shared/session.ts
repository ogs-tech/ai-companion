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
  anchor: SessionAnchor;
  cwd: string;
  /** Human-readable name of the anchor (entity/workspace/project name), for display in a session list. */
  label: string;
  status: SessionStatus;
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
