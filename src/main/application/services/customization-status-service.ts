import type { ChannelId } from '../../../shared/channel.js';
import { worseStatus, type ChannelStatus, type CustomizationStatusReport, type ItemStatus } from '../../../shared/customization-status.js';
import type { DetectedEntity } from '../../../shared/detected.js';
import { entityUrn } from '../../../shared/entity.js';
import type { HealthCheck, HealthReport } from '../../../shared/health.js';
import type { ClockPort } from '../ports/clock-port.js';

/** Where a listed item came from — the slice of `McpProvenance` / a hook's `source` this service reads. */
interface SubjectSource {
  kind: string;
  pluginId?: string;
  harness?: ChannelId;
}

export interface StatusMcp {
  name: string;
  enabled: boolean;
  source: SubjectSource;
}
export interface StatusHook {
  id: string;
  enabled?: boolean;
  source: SubjectSource;
}
export interface StatusPlugin {
  id: string;
  enabled: boolean;
}

export interface CustomizationStatusDeps {
  health: { getReport(scope: 'personal'): Promise<HealthReport> };
  detection: { list(params: { kinds: Array<'skill' | 'agent'> }): Promise<DetectedEntity[]> };
  mcps: () => Promise<readonly StatusMcp[]>;
  hooks: () => Promise<readonly StatusHook[]>;
  plugins: () => Promise<readonly StatusPlugin[]>;
  clock: ClockPort;
}

const DETECTED: ChannelStatus = { status: 'draft', reason: 'detected' };
const DISABLED: ItemStatus = { status: 'draft', reason: 'disabled', channels: {} };

function checkStatus(check: HealthCheck): ChannelStatus | undefined {
  if (check.outcome === undefined) return undefined;
  return check.outcome === 'draft' ? { status: 'draft', reason: 'foreign' } : { status: check.outcome };
}

/** Adds one channel's verdict to an item, keeping the worse per channel and overall. */
function merge(items: Map<string, ItemStatus>, urn: string, channel: ChannelId, verdict: ChannelStatus): void {
  const item = items.get(urn) ?? { status: 'installed', channels: {} };
  const current = item.channels[channel];
  const channels = { ...item.channels, [channel]: current === undefined ? verdict : worseStatus(current, verdict) };
  // Overall: the worst channel, so an error anywhere outranks a conflict elsewhere.
  const overall = Object.values(channels).reduce<ChannelStatus>((acc, c) => worseStatus(acc, c), { status: 'installed' });
  items.set(urn, { ...overall, channels });
}

/**
 * One status per customization, for the Customizações tree: the health report's per-destination outcomes, what
 * was detected in the channels' own files, and what the user turned off — folded with error > draft > installed.
 * Computed per call: it runs on app load, scope switch and entity change, never on a timer.
 */
export class CustomizationStatusService {
  constructor(private readonly deps: CustomizationStatusDeps) {}

  async getReport(): Promise<CustomizationStatusReport> {
    // Issued together so the three detection readers share one scan (see `DetectionService.list`).
    const [health, detected, mcps, hooks, plugins] = await Promise.all([
      this.deps.health.getReport('personal'),
      this.deps.detection.list({ kinds: ['skill', 'agent'] }),
      this.deps.mcps(),
      this.deps.hooks(),
      this.deps.plugins(),
    ]);

    const items = new Map<string, ItemStatus>();
    for (const check of health.checks) {
      const verdict = checkStatus(check);
      if (verdict === undefined || check.entityUrn === undefined || check.channel === undefined) continue;
      merge(items, check.entityUrn, check.channel, verdict);
    }
    for (const d of detected) merge(items, entityUrn(d.kind, d.name), d.harness, DETECTED);

    const pluginChildren: Array<{ urn: string; pluginId: string }> = [];
    const subjects: Array<{ urn: string; source: SubjectSource; disabled: boolean }> = [
      // Only the user's own servers can be turned off; a detected one reports `enabled: false` because the app doesn't manage it.
      ...mcps.map((m) => ({ urn: entityUrn('mcp', m.name), source: m.source, disabled: m.source.kind === 'workspace' && !m.enabled })),
      ...hooks.map((h) => ({ urn: entityUrn('hook', h.id), source: h.source, disabled: h.source.kind !== 'detected' && h.enabled === false })),
    ];
    for (const { urn, source, disabled } of subjects) {
      if (source.kind === 'detected' && source.harness !== undefined) merge(items, urn, source.harness, DETECTED);
      if (source.kind === 'plugin' && source.pluginId !== undefined) pluginChildren.push({ urn, pluginId: source.pluginId });
      if (disabled) items.set(urn, DISABLED);
    }

    // A plugin's hook or MCP failing is the plugin's: the plugin row is where the user acts.
    for (const { urn, pluginId } of pluginChildren) {
      const child = items.get(urn);
      if (child === undefined) continue;
      for (const [channel, verdict] of Object.entries(child.channels) as Array<[ChannelId, ChannelStatus]>) {
        merge(items, `urn:plugin:${pluginId}`, channel, verdict);
      }
    }
    for (const plugin of plugins) if (!plugin.enabled) items.set(`urn:plugin:${plugin.id}`, DISABLED);

    return { generatedAt: this.deps.clock.now().toISOString(), items: Object.fromEntries(items) };
  }
}
