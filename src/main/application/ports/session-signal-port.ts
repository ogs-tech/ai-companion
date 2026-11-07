/**
 * A raw activity signal a harness CLI's hook reported for one session, already
 * parsed but not yet interpreted (see `session-activity.ts`).
 */
export interface SessionSignal {
  event: 'working' | 'idle' | 'notification' | 'tool' | 'permission' | 'session-start';
  /** Hook stdin JSON for `notification`, `tool`, `permission` and `session-start`; absent otherwise. */
  payload?: Record<string, unknown>;
}

export type SessionSignalListener = (sessionId: string, signal: SessionSignal) => void;

/**
 * One append-only channel per session through which a CLI's injected hooks
 * tell the app what the session is doing. The port hands out the file the
 * hook must append to; the hook command and its env var are the contract.
 */
export interface SessionSignalPort {
  /** Creates the (empty) channel for `sessionId` and returns the absolute path hooks append to. Idempotent. */
  prepare(sessionId: string): Promise<string>;
  /** Stops watching and deletes the channel. */
  release(sessionId: string): Promise<void>;
  /** Hands a decision to the `PermissionRequest` hook that is waiting on this session's channel. */
  answer(sessionId: string, decision: 'allow' | 'deny'): Promise<void>;
  /** Single listener, replaced on every call (same convention as `SessionRuntimePort.onData`). */
  onSignal(listener: SessionSignalListener): void;
}
