import type { HealthCheck } from '../../../../shared/health.js';
import type { CoveragePlanEntry } from '../adapter-manager.js';

/**
 * A covered channel reads the covering channel's file, so it has exactly that file's health: each covering check is
 * copied onto the covered channel, marked `coveredBy`, pointing at the file actually read. No covering check → no copy.
 */
export function applyCoverage(checks: readonly HealthCheck[], coverage: readonly CoveragePlanEntry[]): HealthCheck[] {
  const copies: HealthCheck[] = [];
  for (const entry of coverage) {
    for (const check of checks) {
      if (check.entityUrn !== entry.entityUrn || check.channel !== entry.coveredBy || check.coveredBy !== undefined) continue;
      copies.push({
        ...check,
        id: `${check.id}:covered:${entry.adapterId}`,
        channel: entry.adapterId as NonNullable<HealthCheck['channel']>,
        coveredBy: entry.coveredBy,
        target: entry.destination,
      });
    }
  }
  return [...checks, ...copies];
}
