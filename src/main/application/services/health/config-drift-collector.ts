import type { HealthCheck } from '../../../../shared/health.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type { Scope } from '../../ports/scope.js';
import type { PluginListItem } from '../plugin-service.js';
import type { HealthCollector } from './health-collector.js';

/** Minimal slice of PluginService the collector needs. */
export interface PluginDriftLister {
  list(scope: Scope): Promise<PluginListItem[]>;
}

const REMEDIATION: Record<NonNullable<PluginListItem['drift']>['kind'], string> = {
  not_in_settings: 'Enable or remove this plugin so settings and registry agree.',
  not_in_registry: 'Reinstall the plugin or remove it from Claude settings.',
  symlink_missing: 'Re-sync adapters to recreate the plugin symlink.',
};

export class ConfigDriftCollector implements HealthCollector {
  readonly category = 'config-drift' as const;

  constructor(
    private readonly plugins: PluginDriftLister,
    private readonly clock: ClockPort,
  ) {}

  // Scope-partitioned source: the only collector that consumes `scope` — it lists
  // plugins for the requested scope. See HealthCollector docs.
  async collect(scope: Scope): Promise<HealthCheck[]> {
    const items = await this.plugins.list(scope);
    const observedAt = this.clock.now().toISOString();

    return items
      .filter((item): item is PluginListItem & { drift: NonNullable<PluginListItem['drift']> } =>
        item.drift !== undefined,
      )
      .map((item) => {
        const id = String(item.id);
        const detail =
          item.drift.details !== undefined
            ? `${item.drift.kind}: ${item.drift.details}`
            : item.drift.kind;
        return {
          id: `config-drift:${id}`,
          category: 'config-drift',
          severity: 'warning',
          title: `Plugin drift: ${id}`,
          target: id,
          // Plugins are a Claude Code concept: settings and registry are Claude's.
          entityUrn: `urn:plugin:${id}`,
          channel: 'claude',
          detail,
          remediation: REMEDIATION[item.drift.kind],
          observedAt,
        } satisfies HealthCheck;
      });
  }
}
