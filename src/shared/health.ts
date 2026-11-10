import type { ChannelId } from './channel.js';

export type Severity = 'ok' | 'warning' | 'error';

export type HealthCategory = 'mcp-auth' | 'mcp-runtime' | 'config-drift' | 'symlink' | 'generated-file' | 'merge-entry';

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
