import type { HealthCheck } from '../../../../shared/health.js';
import type { ClockPort } from '../../ports/clock-port.js';
import type { PluginEntityFailure } from '../entity-plugin-helpers.js';
import type { HealthCollector } from './health-collector.js';

/**
 * A plugin skill, command or agent whose file cannot be read is left out of the lists. Without a check the
 * plugin looks installed and healthy while part of it is silently missing; this puts the failure on the plugin row.
 */
export class PluginEntityCollector implements HealthCollector {
  readonly category = 'plugin-entity' as const;

  constructor(
    private readonly findFailures: () => Promise<PluginEntityFailure[]>,
    private readonly clock: ClockPort,
  ) {}

  async collect(): Promise<HealthCheck[]> {
    const observedAt = this.clock.now().toISOString();
    return (await this.findFailures()).map(
      (f) =>
        ({
          id: `plugin-entity:${f.pluginId}:${f.file}`,
          category: 'plugin-entity',
          severity: 'warning',
          title: `Plugin file not loaded: ${f.pluginId}`,
          target: f.file,
          // Plugins are a Claude Code concept, as in the config-drift check.
          entityUrn: `urn:plugin:${f.pluginId}`,
          channel: 'claude',
          detail: f.reason,
          remediation: 'Fix the file\'s frontmatter (quote values containing ": " or "["), or update the plugin.',
          observedAt,
        }) satisfies HealthCheck,
    );
  }
}
