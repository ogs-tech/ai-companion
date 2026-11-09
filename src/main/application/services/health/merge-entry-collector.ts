import type { HealthCheck, Severity } from '../../../../shared/health.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type { MergePlanEntry } from '../adapter-manager.js';
import type { MergeState } from '../merge-materializer.js';
import type { HealthCollector } from './health-collector.js';
import { channelOf } from './channel.js';

/** Minimal slices of the collaborators this collector needs. */
export interface MergePlanner {
  planMergeDestinations(): Promise<MergePlanEntry[]>;
}
export interface MergeValidator {
  validate(args: { file: string; target: MergePlanEntry['target'] }): Promise<MergeState>;
}

interface Verdict {
  severity: Severity;
  title: string;
  remediation?: string;
}

function verdictFor(state: MergeState, label: string): Verdict {
  switch (state) {
    case 'ok':
      return { severity: 'ok', title: `Entry OK: ${label}` };
    case 'missing':
      return { severity: 'error', title: `Entry missing: ${label}`, remediation: 'Re-sync the adapter to write this entry.' };
    case 'drift':
      return { severity: 'warning', title: `Entry drifted: ${label}`, remediation: 'Re-sync to overwrite manual edits.' };
    case 'foreign':
      return {
        severity: 'warning',
        title: `Unmanaged entry blocks sync: ${label}`,
        remediation: 'Remove or back up the existing entry, then re-sync.',
      };
  }
}

/**
 * MCP servers and hooks are `merge` destinations — one entry inside a JSON file the user also
 * edits — so neither the symlink nor the generated-file collector sees them.
 */
export class MergeEntryCollector implements HealthCollector {
  readonly category = 'merge-entry' as const;

  constructor(
    private readonly planner: MergePlanner,
    private readonly validator: MergeValidator,
    private readonly clock: ClockPort,
  ) {}

  // Global source: validates every planned merge entry across all scopes — see HealthCollector docs.
  async collect(): Promise<HealthCheck[]> {
    const entries = await this.planner.planMergeDestinations();
    const observedAt = this.clock.now().toISOString();
    const checks: HealthCheck[] = [];
    for (const entry of entries) {
      const state = await this.validator.validate({ file: entry.destination, target: entry.target });
      const label = `${entry.destination} › ${entry.entityUrn}`;
      const verdict = verdictFor(state, label);
      checks.push({
        id: `merge-entry:${entry.adapterId}:${entry.entityUrn}:${entry.destination}`,
        category: 'merge-entry',
        severity: verdict.severity,
        title: verdict.title,
        target: entry.destination,
        entityUrn: entry.entityUrn,
        ...channelOf(entry.adapterId),
        observedAt,
        ...(verdict.remediation !== undefined ? { remediation: verdict.remediation } : {}),
      });
    }
    return checks;
  }
}
