import type { HealthCheck, Severity } from '../../../../shared/health.js';
import type { Settings } from '../../../../shared/settings.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type { Scope } from '../../ports/scope.js';
import type { GeneratedFilePlanEntry } from '../adapter-manager.js';
import type { GeneratedFileState } from '../file-materializer.js';
import type { HealthCollector } from './health-collector.js';
import { channelOf } from './channel.js';

/** Minimal slices of the collaborators this collector needs. */
export interface GeneratedFilePlanner {
  planGeneratedFiles(): Promise<GeneratedFilePlanEntry[]>;
}
export interface GeneratedFileValidator {
  validate(args: { destination: string; content: string }): Promise<GeneratedFileState>;
}
export interface SettingsReader {
  load(): Promise<Settings | null>;
  getDefaults(): Settings;
}

interface Verdict {
  severity: Severity;
  title: string;
  remediation?: string;
}

function verdictFor(state: GeneratedFileState, destination: string): Verdict {
  switch (state) {
    case 'ok':
      return { severity: 'ok', title: `Generated file OK: ${destination}` };
    case 'missing':
      return {
        severity: 'error',
        title: `Generated file missing: ${destination}`,
        remediation: 'Re-sync the adapter to regenerate this file.',
      };
    case 'drift':
      return {
        severity: 'warning',
        title: `Generated file drifted: ${destination}`,
        remediation: 'Re-sync to overwrite manual edits.',
      };
    case 'foreign':
      return {
        severity: 'warning',
        title: `Unmanaged file blocks generation: ${destination}`,
        remediation: 'Remove or back up the file, then re-sync.',
      };
  }
}

export class GeneratedFileCollector implements HealthCollector {
  readonly category = 'generated-file' as const;

  constructor(
    private readonly planner: GeneratedFilePlanner,
    private readonly validator: GeneratedFileValidator,
    // Kept in the constructor signature for backward-compatible wiring — the
    // pre-linkedRepos-removal "no linked repos" warning was retired here.
    // TODO: drop this parameter once every caller stops passing it.
    _settings: SettingsReader,
    private readonly clock: ClockPort,
  ) {}

  // Global source: validates every planned generated file across all scopes.
  // `scope` is accepted (per the HealthCollector contract) but intentionally
  // unused — see HealthCollector docs.
  async collect(_scope: Scope): Promise<HealthCheck[]> {
    const observedAt = this.clock.now().toISOString();
    const checks: HealthCheck[] = [];

    for (const entry of await this.planner.planGeneratedFiles()) {
      const state = await this.validator.validate({ destination: entry.destination, content: entry.content });
      const verdict = verdictFor(state, entry.destination);
      checks.push({
        id: `generated-file:${entry.adapterId}:${entry.destination}`,
        category: 'generated-file',
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
