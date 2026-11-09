import type { HealthCheck, Severity } from '../../../../shared/health.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type { SymlinkPlanEntry } from '../adapter-manager.js';
import type { SymlinkValidateState } from '../symlink-manager.js';
import type { HealthCollector } from './health-collector.js';
import { channelOf } from './channel.js';

/** Minimal slices of the collaborators this collector needs. */
export interface SymlinkPlanner {
  planDestinations(): Promise<SymlinkPlanEntry[]>;
}

export interface SymlinkValidator {
  validate(args: { destination: string; source?: string }): Promise<SymlinkValidateState>;
}

interface Verdict {
  severity: Severity;
  title: string;
  remediation?: string;
}

function verdictFor(state: SymlinkValidateState, destination: string): Verdict {
  switch (state) {
    case 'symlink-to-source':
      return { severity: 'ok', title: `Symlink OK: ${destination}` };
    case 'none':
      return {
        severity: 'error',
        title: `Symlink missing: ${destination}`,
        remediation: 'Re-sync the adapter to recreate this symlink.',
      };
    case 'symlink-to-other':
      return {
        severity: 'error',
        title: `Symlink points elsewhere: ${destination}`,
        remediation: 'Re-sync the adapter to repoint this symlink.',
      };
    case 'real-file':
      return {
        severity: 'warning',
        title: `Real file blocks symlink: ${destination}`,
        remediation: 'Remove or back up the real file, then re-sync.',
      };
  }
}

export class SymlinkCollector implements HealthCollector {
  readonly category = 'symlink' as const;

  constructor(
    private readonly planner: SymlinkPlanner,
    private readonly validator: SymlinkValidator,
    private readonly clock: ClockPort,
  ) {}

  // Global source: validates every planned symlink destination across all scopes,
  // so `scope` is intentionally omitted — see HealthCollector docs.
  async collect(): Promise<HealthCheck[]> {
    const entries = await this.planner.planDestinations();
    const observedAt = this.clock.now().toISOString();

    const checks: HealthCheck[] = [];
    for (const entry of entries) {
      const state = await this.validator.validate({
        destination: entry.destination,
        source: entry.source,
      });
      const verdict = verdictFor(state, entry.destination);
      checks.push({
        id: `symlink:${entry.adapterId}:${entry.destination}`,
        category: 'symlink',
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
