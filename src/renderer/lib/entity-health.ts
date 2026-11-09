import { HARNESS_IDS, HARNESSES, type HarnessId } from '../../shared/harness.js';
import type { HealthCheck } from '../../shared/health.js';

/** urn → the channels where that item has a problem, in registry order (Claude first). */
export type ChannelProblems = ReadonlyMap<string, readonly HarnessId[]>;

/**
 * Joins a health report to tree rows: every non-ok check that names an entity and a channel puts that
 * channel on the entity. The tree and Diagnósticos read the same checks, so a ⚠ always has a matching one.
 */
export function channelProblems(checks: readonly HealthCheck[]): ChannelProblems {
  const failing = new Map<string, Set<HarnessId>>();
  for (const check of checks) {
    if (check.severity === 'ok' || check.entityUrn === undefined || check.channel === undefined) continue;
    const channels = failing.get(check.entityUrn) ?? new Set<HarnessId>();
    channels.add(check.channel);
    failing.set(check.entityUrn, channels);
  }
  const ordered = new Map<string, readonly HarnessId[]>();
  for (const [urn, channels] of failing) ordered.set(urn, HARNESS_IDS.filter((id) => channels.has(id)));
  return ordered;
}

/** How many of `urns` have at least one failing channel: a folder counts items, not channel failures. */
export function countProblems(problems: ChannelProblems, urns: Iterable<string>): number {
  let n = 0;
  for (const urn of urns) if ((problems.get(urn)?.length ?? 0) > 0) n++;
  return n;
}

/** `Claude · Cursor` */
export function channelNames(channels: readonly HarnessId[]): string {
  return channels.map((id) => HARNESSES[id].displayName).join(' · ');
}
