import { describe, expect, it } from 'vitest';
import { HealthService } from '../../../../../src/main/application/services/health/health-service.js';
import type { HealthCollector } from '../../../../../src/main/application/services/health/health-collector.js';
import type { HealthCheck } from '../../../../../src/shared/health.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';

const FROZEN = new Date('2026-06-05T10:00:00.000Z');

const fakeCollector = (
  category: HealthCheck['category'],
  checks: HealthCheck[],
): HealthCollector => ({
  category,
  collect: () => Promise.resolve(checks),
});

const check = (
  category: HealthCheck['category'],
  severity: HealthCheck['severity'],
): HealthCheck => ({
  id: `${category}:${severity}`,
  category,
  severity,
  title: 't',
  observedAt: FROZEN.toISOString(),
});

describe('HealthService.getReport', () => {
  it('aggregates checks from all collectors with worst rollup and counts', async () => {
    const service = new HealthService(
      [
        fakeCollector('mcp-auth', [check('mcp-auth', 'warning')]),
        fakeCollector('symlink', [check('symlink', 'ok'), check('symlink', 'error')]),
      ],
      new FixedClock(FROZEN),
    );

    const report = await service.getReport('personal');

    expect(report.generatedAt).toBe(FROZEN.toISOString());
    expect(report.checks).toHaveLength(3);
    expect(report.worst).toBe('error');
    expect(report.counts).toEqual({ ok: 1, warning: 1, error: 1 });
  });

  it('produces worst=ok and zero error count when all checks pass', async () => {
    const service = new HealthService(
      [fakeCollector('mcp-runtime', [check('mcp-runtime', 'ok')])],
      new FixedClock(FROZEN),
    );

    const report = await service.getReport('personal');

    expect(report.worst).toBe('ok');
    expect(report.counts.error).toBe(0);
  });

  it('isolates a throwing collector into its own error check', async () => {
    const boom: HealthCollector = {
      category: 'config-drift',
      collect: () => Promise.reject(new Error('disk on fire')),
    };
    const service = new HealthService(
      [boom, fakeCollector('mcp-auth', [check('mcp-auth', 'ok')])],
      new FixedClock(FROZEN),
    );

    const report = await service.getReport('personal');

    expect(report.checks).toHaveLength(2);
    const failure = report.checks.find((c) => c.category === 'config-drift');
    expect(failure).toMatchObject({ severity: 'error', cause: 'collector-failed', observedAt: FROZEN.toISOString() });
    expect(failure?.detail).toContain('disk on fire');
    expect(report.worst).toBe('error');
  });
});

describe('HealthService — coverage', () => {
  it('applies the coverage plan after the collectors', async () => {
    const { HealthService } = await import('../../../../../src/main/application/services/health/health-service.js');
    const { FixedClock } = await import('../../../../../src/main/infrastructure/clock/fixed-clock.js');
    const claude = {
      id: 'link', category: 'symlink' as const, severity: 'ok' as const, title: 't', entityUrn: 'urn:skill:tdd',
      channel: 'claude' as const, outcome: 'installed' as const, observedAt: '',
    };
    const service = new HealthService(
      [{ category: 'symlink', collect: async () => [claude] }],
      new FixedClock(new Date('2026-11-17T10:00:00.000Z')),
      async () => [{ adapterId: 'cursor', entityUrn: 'urn:skill:tdd', coveredBy: 'claude', destination: '/c' }],
    );
    const report = await service.getReport('personal');
    expect(report.checks.map((c) => c.channel)).toEqual(['claude', 'cursor']);
  });
});
