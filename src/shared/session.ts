import type { HarnessId } from './harness.js';

export type SessionStatus = 'running' | 'exited';

/**
 * What a *running* session is doing right now. `needs-input` means blocked on
 * a question or permission prompt only the user can give — never merely
 * "finished its turn" (that is `idle`). Absent on a snapshot = no signal yet,
 * which the UI shows as today's plain "running" look.
 */
export type SessionActivity = 'needs-input' | 'working' | 'idle';

/** Why a session is `needs-input`; `detail` is a short human hint (e.g. the tool awaiting permission). */
export interface SessionAttention {
  kind: 'permission' | 'question';
  detail?: string;
}

/**
 * Shared by both `SessionPanel` (client-side check, fast feedback before
 * anything is sent) and `SessionService.stageAttachment` (the same check
 * re-enforced at the IPC boundary) so the two limits can't drift apart.
 * Mirrors the `claude` CLI's own image-attachment ceiling.
 */
export const MAX_SESSION_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** `personal` runs in the home dir (Global/Início); `workspace` in the folder(s) it was started with. */
export type SessionAnchor =
  | { kind: 'entity'; urn: string }
  | { kind: 'personal' }
  | {
      kind: 'workspace';
      workspaceId: string;
      /**
       * The workspace folders this session sees; absent = the primary folder.
       * One folder: it is the cwd. Two or more: a helper directory linking to
       * exactly these folders. Folders left out are completely outside the session.
       */
      folders?: string[];
    };

export function sessionAnchorKey(anchor: SessionAnchor): string {
  if (anchor.kind === 'entity') return `entity:${anchor.urn}`;
  if (anchor.kind === 'workspace') return `workspace:${anchor.workspaceId}`;
  return 'personal';
}

export interface SessionSnapshot {
  sessionId: string;
  /** The harness whose CLI runs this session. */
  harness: HarnessId;
  /**
   * The conversation's id as the harness's CLI knows it. For Claude it is a
   * UUID minted at spawn and handed to the CLI via `--session-id`, which makes
   * the CLI write its transcript to `~/.claude/projects/<slug>/<uuid>.jsonl`;
   * for Cursor it is the chat id from `cursor-agent create-chat`.
   *
   * Deliberately separate from `sessionId`, the app's own key: that one is
   * `sessionAnchorKey(anchor)` for entity anchors (`entity:urn:skill:foo`),
   * which cannot be passed to a CLI. This field is the exact join between a
   * live session and its entry in the session history.
   */
  conversationId: string;
  anchor: SessionAnchor;
  cwd: string;
  /** Human-readable name of the anchor (entity/workspace name), for display in a session list. */
  label: string;
  status: SessionStatus;
  /**
   * Whether this session's embedded browser tool is on — set only via
   * `browser.enable`/`browser.disable` on an already-spawned session, always
   * `false` on a brand-new spawn. The CLI only reads its `--mcp-config` at its
   * own startup, so toggling this on a running session has no live effect
   * until the session is next restarted (`session.kill` + `session.resume`).
   */
  browserEnabled: boolean;
  /** Present only while `status === 'running'`. A session with no signal yet is `idle`: `working` means a turn is running. */
  activity?: SessionActivity;
  /** Epoch ms of the last `activity` change — drives "espera <duração>" for `needs-input`. */
  activitySince?: number;
  /** Set only while `activity === 'needs-input'`. */
  attention?: SessionAttention;
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
/** Push channel main→renderer fired whenever a running session's `activity` changes. */
export const SESSION_ACTIVITY_CHANNEL = 'session:activity' as const;

export interface SessionActivityEvent {
  sessionId: string;
}
