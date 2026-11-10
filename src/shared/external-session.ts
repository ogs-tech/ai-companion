import type { ChannelId } from './channel.js';
import type { SessionSnapshot } from './session.js';

/**
 * How exact external-session state may be. `unset` = the consent banner has not
 * been answered; `exact` = signal hooks installed in the harnesses' own config;
 * `estimated` = "Só estimado": no config touched, state read off transcripts/processes.
 */
export type ExternalConsent = 'unset' | 'exact' | 'estimated';

/** `measured` comes from a hook; `estimated` from a transcript's mtime or a process list and renders with a dashed indicator. */
export type ExternalPrecision = 'measured' | 'estimated';

/** A Claude or Cursor session running outside the app: observed, never controlled. */
export interface ExternalSession
  extends Pick<SessionSnapshot, 'activity' | 'activitySince' | 'attention' | 'activityDetail' | 'editingFile' | 'changedFiles' | 'usedAt'> {
  /** The harness's own conversation id (Claude: transcript basename; Cursor: chat id) or `<harness>-proc:<pid>` for a process with no signal. */
  id: string;
  harness: ChannelId;
  cwd: string | null;
  /** Folder name of `cwd`, or the id's prefix when unknown. */
  label: string;
  /** The CLI's own title for the conversation, read off its transcript as soon as it is written; absent until then. */
  title?: string;
  /** The process is gone (or never seen after hooks reported it). Exit reason is unknowable from outside. */
  closed: boolean;
  precision: ExternalPrecision;
  /** Where it runs ("iTerm2", "Terminal", "VS Code"…), from the process ancestry; absent when unknown. */
  terminal?: string;
  /** Epoch ms of the last signal / transcript change / process sighting. */
  lastEventAt: number;
}

export interface ExternalSessionsState {
  consent: ExternalConsent;
  /** Per harness: whether the signal hook entry is currently installed. */
  hooksInstalled: Record<ChannelId, boolean>;
  sessions: ExternalSession[];
}

/** Push channel main→renderer (no payload): external sessions or consent changed; the renderer refetches `externalSession.state`. */
export const EXTERNAL_SESSIONS_CHANNEL = 'external-sessions:changed' as const;

/** Thresholds (starting values, per spec; tune with measurements). */
export const EXTERNAL_WORKING_WINDOW_MS = 3_000;
export const EXTERNAL_TAIL_BYTES = 8 * 1024;
export const EXTERNAL_SCAN_VISIBLE_MS = 5_000;
export const EXTERNAL_SCAN_HIDDEN_MS = 30_000;
