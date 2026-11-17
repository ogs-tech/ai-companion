import type { ChannelId } from './channel.js';

/**
 * Where a customization stands with the channels it goes to:
 * - `installed` — every check is ok;
 * - `draft` — not meant to be installed yet: found in a channel's files but not imported (`detected`), or
 *   turned off (`disabled`);
 * - `error` — something is wrong: missing, stale, a conflict (a file the app doesn't own blocks a destination),
 *   auth, runtime, unreadable.
 */
export type CustomizationStatus = 'installed' | 'draft' | 'error';
export type DraftReason = 'detected' | 'disabled';

export interface ChannelStatus {
  status: CustomizationStatus;
  /** Set when `status === 'draft'`. */
  reason?: DraftReason;
}

export interface ItemStatus extends ChannelStatus {
  /** Per channel that has a say; a disabled item has none (it goes nowhere). */
  channels: Partial<Record<ChannelId, ChannelStatus>>;
}

export interface CustomizationStatusReport {
  generatedAt: string;
  /** urn → status. An item absent here has nothing checked yet (no channel on, or unknown): no status. */
  items: Record<string, ItemStatus>;
}

const RANK: Record<CustomizationStatus, number> = { installed: 0, draft: 1, error: 2 };

/** error > draft > installed: the worse of two statuses (the first wins a tie, keeping its reason). */
export function worseStatus(a: ChannelStatus, b: ChannelStatus): ChannelStatus {
  return RANK[b.status] > RANK[a.status] ? b : a;
}
