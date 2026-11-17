import { describe, expect, it } from 'vitest';
import { applyCoverage } from '../../../../../src/main/application/services/health/coverage.js';
import type { HealthCheck } from '../../../../../src/shared/health.js';
import type { CoveragePlanEntry } from '../../../../../src/main/application/services/adapter-manager.js';

const check = (over: Partial<HealthCheck> = {}): HealthCheck => ({
  id: 'symlink:urn:skill:tdd:claude',
  category: 'symlink',
  severity: 'ok',
  title: 'tdd',
  target: '/home/u/.claude/skills/tdd',
  entityUrn: 'urn:skill:tdd',
  channel: 'claude',
  outcome: 'installed',
  observedAt: '2026-11-17T10:00:00.000Z',
  ...over,
});
const entry: CoveragePlanEntry = { adapterId: 'cursor', entityUrn: 'urn:skill:tdd', coveredBy: 'claude', destination: '/home/u/.claude/skills/tdd' };

describe('applyCoverage', () => {
  it('gives the covered channel a copy of the covering channel verdict', () => {
    const out = applyCoverage([check()], [entry]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      id: 'symlink:urn:skill:tdd:claude:covered:cursor',
      channel: 'cursor',
      coveredBy: 'claude',
      target: '/home/u/.claude/skills/tdd',
      severity: 'ok',
      outcome: 'installed',
    });
  });

  it('copies an error too — the covered channel shows the same failure', () => {
    const out = applyCoverage([check({ severity: 'error', outcome: 'error' })], [entry]);
    expect(out[1]).toMatchObject({ channel: 'cursor', severity: 'error', outcome: 'error', coveredBy: 'claude' });
  });

  it('adds nothing when the covering channel has no check, and leaves checks alone without coverage', () => {
    expect(applyCoverage([check({ entityUrn: 'urn:skill:other' })], [entry])).toHaveLength(1);
    const checks = [check()];
    expect(applyCoverage(checks, [])).toEqual(checks);
  });
});
