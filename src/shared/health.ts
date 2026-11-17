import type { ChannelId } from './channel.js';

export type Severity = 'ok' | 'warning' | 'error';

import type { CustomizationStatus } from './customization-status.js';

/** A health check's verdict for its customization; `draft` means a file the app doesn't own holds the destination (not installed). */
export type CheckOutcome = CustomizationStatus;

export type HealthCategory = 'mcp-auth' | 'mcp-runtime' | 'config-drift' | 'symlink' | 'generated-file' | 'merge-entry' | 'plugin-entity';

export interface HealthCheck {
  /** Stable id, e.g. "mcp-auth:claude.ai Gmail". Used for notification diffing. */
  id: string;
  category: HealthCategory;
  severity: Severity;
  title: string;
  detail?: string;
  /** MCP/plugin/symlink name this check is about. */
  target?: string;
  /** URN of the customization this check is about (`urn:skill:x`, `urn:hook:y`, `urn:plugin:z`), when it concerns one — the key the customizations tree joins on. */
  entityUrn?: string;
  /** The harness (channel) this check concerns. Absent for checks that are not channel-specific. */
  channel?: ChannelId;
  /**
   * What this check means for its customization's status, set by the collector. A destination the app installed
   * that went wrong (missing, stale, repointed) is an `error`; one held by a file the app doesn't own is `draft`
   * (not installed — the user installs over it from the tree). Set whenever `entityUrn` is.
   */
  outcome?: CheckOutcome;
  /** Set on a covered channel's check: that channel reads `coveredBy`'s file natively, and this is that file's verdict. */
  coveredBy?: ChannelId;
  /** Actionable hint, e.g. "Run /mcp to authenticate". */
  remediation?: string;
  /** ISO timestamp, stamped by the service via ClockPort. */
  observedAt: string;
}

export interface HealthReport {
  generatedAt: string;
  /** Drives the nav badge color. */
  worst: Severity;
  counts: { ok: number; warning: number; error: number };
  checks: HealthCheck[];
}
