import { CHANNEL_IDS, channelSupports, type ChannelId } from '../../shared/channel.js';
import type { HealthCheck } from '../../shared/health.js';

export interface SyncLine {
  /** Where the channel receives the item (the check's `target`). */
  path?: string;
  text: string;
  remediation?: string;
}

export type SyncRow =
  | { channel: ChannelId; status: 'ok' | 'problem'; lines: SyncLine[] }
  /** `off` = the channel's toggle is off; `run-only` = it never receives customizations; `unchecked` = no check yet. */
  | { channel: ChannelId; status: 'off' | 'run-only' | 'unchecked' };

export type SyncView = { kind: 'entity-disabled' } | { kind: 'channels'; rows: SyncRow[] };

export interface ChannelSyncInput {
  urn: string;
  checks: readonly HealthCheck[];
  adapters: Readonly<Record<ChannelId, { enabled: boolean }>>;
  entityEnabled: boolean;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function okText(check: HealthCheck): string {
  switch (check.category) {
    case 'symlink':
      return 'Ligado por link simbólico';
    case 'generated-file':
      return 'Arquivo gerado';
    case 'merge-entry':
      return check.target !== undefined ? `Entrada em ${basename(check.target)}` : 'Entrada mesclada';
    default:
      return check.title;
  }
}

function lineOf(check: HealthCheck): SyncLine {
  const path = check.target !== undefined ? { path: check.target } : {};
  if (check.severity === 'ok') return { ...path, text: okText(check) };
  return {
    ...path,
    text: check.detail !== undefined ? `${check.title} — ${check.detail}` : check.title,
    ...(check.remediation !== undefined ? { remediation: check.remediation } : {}),
  };
}

/**
 * Where one item goes in each channel, from the health report's per-destination checks (ok ones included):
 * a path and how it is delivered, or what is wrong there. Every channel gets a row, so none is silently missing.
 */
export function channelSyncRows({ urn, checks, adapters, entityEnabled }: ChannelSyncInput): SyncView {
  if (!entityEnabled) return { kind: 'entity-disabled' };
  const rows = CHANNEL_IDS.map((channel): SyncRow => {
    if (!channelSupports(channel, 'manage')) return { channel, status: 'run-only' };
    if (adapters[channel]?.enabled !== true) return { channel, status: 'off' };
    const mine = checks.filter((c) => c.entityUrn === urn && c.channel === channel);
    if (mine.length === 0) return { channel, status: 'unchecked' };
    return { channel, status: mine.some((c) => c.severity !== 'ok') ? 'problem' : 'ok', lines: mine.map(lineOf) };
  });
  return { kind: 'channels', rows };
}
