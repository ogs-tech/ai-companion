import { describe, expect, it } from 'vitest';
import { MergeEntryCollector } from '../../../../../src/main/application/services/health/merge-entry-collector.js';
import type { MergePlanEntry } from '../../../../../src/main/application/services/adapter-manager.js';
import type { MergeState } from '../../../../../src/main/application/services/merge-materializer.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';

const FROZEN = new Date('2026-06-05T10:00:00.000Z');

const entry = (adapterId: string, entityUrn: string): MergePlanEntry => ({
  adapterId,
  entityUrn,
  destination: `/home/.${adapterId}/hooks.json`,
  target: { path: ['hooks'], value: {} } as unknown as MergePlanEntry['target'],
});

const make = (entries: MergePlanEntry[], state: MergeState) =>
  new MergeEntryCollector(
    { planMergeDestinations: () => Promise.resolve(entries) },
    { validate: () => Promise.resolve(state) },
    new FixedClock(FROZEN),
  );

describe('MergeEntryCollector', () => {
  it('reports category merge-entry', () => {
    expect(make([], 'ok').category).toBe('merge-entry');
  });

  it('ties each check to its entity and channel', async () => {
    const checks = await make([entry('cursor', 'urn:hook:stop')], 'ok').collect();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      category: 'merge-entry',
      severity: 'ok',
      entityUrn: 'urn:hook:stop',
      channel: 'cursor',
      observedAt: FROZEN.toISOString(),
    });
  });

  it('maps missing to error and drift/foreign to warning, with a remediation', async () => {
    for (const [state, severity] of [['missing', 'error'], ['drift', 'warning'], ['foreign', 'warning']] as const) {
      const [check] = await make([entry('claude', 'urn:mcp:docs')], state).collect();
      expect(check?.severity).toBe(severity);
      expect(check?.remediation).toBeDefined();
    }
  });
});
