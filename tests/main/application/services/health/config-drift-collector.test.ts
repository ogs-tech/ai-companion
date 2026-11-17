import { describe, expect, it } from 'vitest';
import {
  ConfigDriftCollector,
  type PluginDriftLister,
} from '../../../../../src/main/application/services/health/config-drift-collector.js';
import type { PluginListItem } from '../../../../../src/main/application/services/plugin-service.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';

const FROZEN = new Date('2026-06-05T10:00:00.000Z');

const item = (id: string, drift?: PluginListItem['drift']): PluginListItem =>
  ({
    id: id as PluginListItem['id'],
    origin: 'imported',
    scope: 'personal',
    enabled: true,
    installedAt: FROZEN.toISOString(),
    ...(drift !== undefined ? { drift } : {}),
  }) as PluginListItem;

const setup = (items: PluginListItem[]) => {
  const plugins: PluginDriftLister = { list: () => Promise.resolve(items) };
  return new ConfigDriftCollector(plugins, new FixedClock(FROZEN));
};

describe('ConfigDriftCollector', () => {
  it('reports category config-drift', () => {
    expect(setup([]).category).toBe('config-drift');
  });

  it('emits no checks when no plugin has drift', async () => {
    const collector = setup([item('clean')]);
    await expect(collector.collect('personal')).resolves.toEqual([]);
  });

  it('emits a warning check per drifting plugin with kind in the detail', async () => {
    const collector = setup([
      item('clean'),
      item('ghost', { kind: 'not_in_registry' }),
      item('missing', { kind: 'not_cached', details: 'cache gone' }),
    ]);

    const checks = await collector.collect('personal');

    expect(checks).toHaveLength(2);
    const ghost = checks.find((c) => c.target === 'ghost');
    expect(ghost).toMatchObject({
      id: 'config-drift:ghost',
      category: 'config-drift',
      severity: 'warning',
      observedAt: FROZEN.toISOString(),
    });
    expect(ghost?.detail).toContain('not_in_registry');
    expect(checks.find((c) => c.target === 'missing')?.detail).toContain('cache gone');
  });
});
