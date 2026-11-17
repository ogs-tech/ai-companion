import { CHANNEL_IDS, CHANNELS, type ChannelId } from '../../shared/channel.js';
import type { HealthCheck } from '../../shared/health.js';

/** urn → the channels where that item has a problem, in registry order (Claude first). */
export type ChannelProblems = ReadonlyMap<string, readonly ChannelId[]>;

/**
 * Joins a health report to tree rows: every non-ok check that names an entity and a channel puts that
 * channel on the entity. The tree and Diagnósticos read the same checks, so a ⚠ always has a matching one.
 */
export function channelProblems(checks: readonly HealthCheck[]): ChannelProblems {
  const failing = new Map<string, Set<ChannelId>>();
  for (const check of checks) {
    if (check.severity === 'ok' || check.entityUrn === undefined || check.channel === undefined) continue;
    const channels = failing.get(check.entityUrn) ?? new Set<ChannelId>();
    channels.add(check.channel);
    failing.set(check.entityUrn, channels);
  }
  const ordered = new Map<string, readonly ChannelId[]>();
  for (const [urn, channels] of failing) ordered.set(urn, CHANNEL_IDS.filter((id) => channels.has(id)));
  return ordered;
}

/** How many of `urns` have at least one failing channel: a folder counts items, not channel failures. */
export function countProblems(problems: ChannelProblems, urns: Iterable<string>): number {
  return problemUrns(problems, urns).length;
}

/** The `urns` with at least one failing channel, in input order — what a list reports up to its folder. */
export function problemUrns(problems: ChannelProblems, urns: Iterable<string>): string[] {
  const failing: string[] = [];
  for (const urn of urns) if ((problems.get(urn)?.length ?? 0) > 0) failing.push(urn);
  return failing;
}

/** `Claude · Cursor` */
export function channelNames(channels: readonly ChannelId[]): string {
  return channels.map((id) => CHANNELS[id].displayName).join(' · ');
}

/** A tree item that a plugin provides: its own urn and the plugin it belongs to. */
export interface PluginChild {
  readonly urn: string;
  readonly pluginId: string;
}

/**
 * A plugin's hook or MCP failing is the plugin's problem: the plugin row (`urn:plugin:<id>`) inherits the
 * failing channels of everything it provides, so the warning shows where the user acts (the plugin),
 * not in Integrações, which lists only the user's own items.
 */
export function rollUpToPlugins(problems: ChannelProblems, children: Iterable<PluginChild>): ChannelProblems {
  const merged = new Map<string, Set<ChannelId>>();
  for (const { urn, pluginId } of children) {
    const failing = problems.get(urn);
    if (failing === undefined || failing.length === 0) continue;
    const key = `urn:plugin:${pluginId}`;
    const set = merged.get(key) ?? new Set<ChannelId>(problems.get(key) ?? []);
    for (const id of failing) set.add(id);
    merged.set(key, set);
  }
  if (merged.size === 0) return problems;
  const out = new Map(problems);
  for (const [key, set] of merged) out.set(key, CHANNEL_IDS.filter((id) => set.has(id)));
  return out;
}
