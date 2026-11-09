import { describe, expect, it } from 'vitest';
import {
  SymlinkCollector,
  type SymlinkPlanner,
  type SymlinkValidator,
} from '../../../../../src/main/application/services/health/symlink-collector.js';
import type { SymlinkPlanEntry } from '../../../../../src/main/application/services/adapter-manager.js';
import type { SymlinkValidateState } from '../../../../../src/main/application/services/symlink-manager.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';

const FROZEN = new Date('2026-06-05T10:00:00.000Z');

const entry = (destination: string): SymlinkPlanEntry => ({
  adapterId: 'claude',
  entityUrn: `urn:skill:${destination}`,
  source: `/ws/skills/${destination}`,
  destination: `/home/.claude/skills/${destination}`,
  scope: 'personal',
});

const setup = (
  entries: SymlinkPlanEntry[],
  states: Record<string, SymlinkValidateState>,
) => {
  const planner: SymlinkPlanner = { planDestinations: () => Promise.resolve(entries) };
  const validator: SymlinkValidator = {
    validate: ({ destination }) => Promise.resolve(states[destination] ?? 'none'),
  };
  return new SymlinkCollector(planner, validator, new FixedClock(FROZEN));
};

describe('SymlinkCollector', () => {
  it('reports category symlink', () => {
    expect(setup([], {}).category).toBe('symlink');
  });

  it('classifies a correct link as ok', async () => {
    const collector = setup([entry('alpha')], {
      '/home/.claude/skills/alpha': 'symlink-to-source',
    });
    const checks = await collector.collect();
    expect(checks[0]).toMatchObject({
      category: 'symlink',
      severity: 'ok',
      target: '/home/.claude/skills/alpha',
      entityUrn: 'urn:skill:alpha',
      channel: 'claude',
      observedAt: FROZEN.toISOString(),
    });
  });

  it('classifies a missing link as error', async () => {
    const collector = setup([entry('alpha')], { '/home/.claude/skills/alpha': 'none' });
    const checks = await collector.collect();
    expect(checks[0]?.severity).toBe('error');
    expect(checks[0]?.remediation).toBeDefined();
  });

  it('classifies a link pointing elsewhere as error', async () => {
    const collector = setup([entry('alpha')], {
      '/home/.claude/skills/alpha': 'symlink-to-other',
    });
    expect((await collector.collect())[0]?.severity).toBe('error');
  });

  it('classifies a real file at the destination as warning', async () => {
    const collector = setup([entry('alpha')], {
      '/home/.claude/skills/alpha': 'real-file',
    });
    expect((await collector.collect())[0]?.severity).toBe('warning');
  });
});
