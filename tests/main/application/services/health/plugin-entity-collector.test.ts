import { describe, expect, it } from 'vitest';
import { PluginEntityCollector } from '../../../../../src/main/application/services/health/plugin-entity-collector.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';

const clock = new FixedClock(new Date('2026-06-05T10:00:00.000Z'));

describe('PluginEntityCollector', () => {
  it('reports nothing when every plugin file loads', async () => {
    expect(await new PluginEntityCollector(() => Promise.resolve([]), clock).collect()).toEqual([]);
  });

  it('puts an unreadable plugin file on the plugin row as a Claude warning', async () => {
    const collector = new PluginEntityCollector(
      () => Promise.resolve([{ pluginId: 'code-modernization', file: '/p/commands/modernize.md', reason: 'bad yaml' }]),
      clock,
    );
    const [check] = await collector.collect();
    expect(check).toMatchObject({
      category: 'plugin-entity',
      severity: 'warning',
      cause: 'not-loaded',
      entityUrn: 'urn:plugin:code-modernization',
      channel: 'claude',
      detail: 'bad yaml',
      target: '/p/commands/modernize.md',
    });
  });
});
