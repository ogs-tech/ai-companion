import type { CheckCause, CheckOutcome, HealthCheck, Severity } from '../../../../shared/health.js';
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
  cause?: CheckCause;
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
        cause: 'missing',
        remediation: 'Re-sync the adapter to recreate this symlink.',
      };
    case 'symlink-to-other':
      return {
        severity: 'error',
        title: `Symlink points elsewhere: ${destination}`,
        cause: 'repointed',
        remediation: 'Re-sync the adapter to repoint this symlink.',
      };
    case 'real-file':
      return {
        severity: 'warning',
        title: `Not installed — an unmanaged file is at: ${destination}`,
        cause: 'unmanaged',
        remediation: 'Install it from the customizations tree (the existing file is backed up).',
      };
  }
}

/** A real file/folder the app never put there means not installed (draft); any other deviation is an error. */
function outcomeFor(state: SymlinkValidateState): CheckOutcome {
  if (state === 'symlink-to-source') return 'installed';
  return state === 'real-file' ? 'draft' : 'error';
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
        outcome: outcomeFor(state),
        ...channelOf(entry.adapterId),
        ...(verdict.cause !== undefined ? { cause: verdict.cause, expected: entry.source } : {}),
        observedAt,
        ...(verdict.remediation !== undefined ? { remediation: verdict.remediation } : {}),
      });
    }
    return checks;
  }
}
