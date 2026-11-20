import { describe, expect, it } from 'vitest';
import { buildDiagnosticsMatrix, worst } from '../../../src/renderer/lib/diagnostics-matrix.js';
import type { HealthCheck } from '../../../src/shared/health.js';

const on = { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: false } };

/** `channel: undefined` builds a check about no channel. */
const check = (over: { [K in keyof HealthCheck]?: HealthCheck[K] | undefined }): HealthCheck => ({
  id: `${over.entityUrn}:${over.channel ?? 'claude'}:${over.target ?? ''}`,
  category: 'symlink',
  severity: 'ok',
  title: 't',
  channel: 'claude',
  observedAt: '',
  ...over,
}) as HealthCheck;

describe('worst', () => {
  it('ranks error over warning over ok, and is null for nothing', () => {
    expect(worst(['ok', 'error', 'warning'])).toBe('error');
    expect(worst(['ok', null])).toBe('ok');
    expect(worst([null])).toBeNull();
  });
});

describe('buildDiagnosticsMatrix', () => {
  it('columns are the channels that are on and receive customizations — never a run-only one', () => {
    expect(buildDiagnosticsMatrix({ checks: [], adapters: { ...on, lmstudio: { enabled: true } } }).channels).toEqual(['claude', 'cursor']);
    expect(buildDiagnosticsMatrix({ checks: [], adapters: { ...on, cursor: { enabled: false } } }).channels).toEqual(['claude']);
  });

  it('a channel that is off still gets a column when a check names it, so no check is dropped', () => {
    const m = buildDiagnosticsMatrix({ checks: [check({ entityUrn: 'urn:skill:a', channel: 'cursor' })], adapters: { ...on, cursor: { enabled: false } } });
    expect(m.channels).toEqual(['claude', 'cursor']);
  });

  it('groups rows in tree order and by name, and a row takes the worst of its cells', () => {
    const m = buildDiagnosticsMatrix({
      checks: [
        check({ entityUrn: 'urn:hook:stop' }),
        check({ entityUrn: 'urn:skill:zeta' }),
        check({ entityUrn: 'urn:skill:alpha', channel: 'cursor', severity: 'warning' }),
        check({ entityUrn: 'urn:instruction:default' }),
      ],
      adapters: on,
    });
    expect(m.groups.map((g) => [g.id, g.rows.map((r) => r.name)])).toEqual([
      ['instruction', ['default']],
      ['skill', ['alpha', 'zeta']],
      ['hook', ['stop']],
    ]);
    const alpha = m.groups[1]?.rows[0];
    expect(alpha?.severity).toBe('warning');
    expect(alpha?.cells.map((c) => c.severity)).toEqual([null, 'warning']);
  });

  it('a plugin lists its Claude servers under it and rolls their state up', () => {
    const m = buildDiagnosticsMatrix({
      checks: [
        check({ entityUrn: 'urn:mcp:search', category: 'mcp-runtime', target: 'plugin:sp:search', severity: 'error' }),
        check({ entityUrn: 'urn:mcp:github', category: 'mcp-runtime', target: 'github' }),
      ],
      adapters: on,
    });
    const plugin = m.groups.find((g) => g.id === 'plugin')?.rows[0];
    expect(plugin).toMatchObject({ urn: 'urn:plugin:sp', severity: 'error' });
    expect(plugin?.cells[0]).toMatchObject({ severity: 'error', checks: [] });
    expect(plugin?.children.map((c) => c.key)).toEqual(['urn:plugin:sp>urn:mcp:search']);
    // The plugin's server is not listed again as a standalone MCP
    expect(m.groups.find((g) => g.id === 'mcp')?.rows.map((r) => r.name)).toEqual(['github']);
  });

  it('problems are top-level rows, errors first; counts include checks about no customization', () => {
    const m = buildDiagnosticsMatrix({
      checks: [
        check({ entityUrn: 'urn:skill:b', severity: 'warning' }),
        check({ entityUrn: 'urn:skill:a', severity: 'error' }),
        check({ entityUrn: 'urn:skill:c' }),
        check({ id: 'collector-error:x', channel: undefined, severity: 'error' }),
      ],
      adapters: on,
    });
    expect(m.problems.map((r) => r.name)).toEqual(['a', 'b']);
    expect(m.general.map((c) => c.id)).toEqual(['collector-error:x']);
    expect(m.counts).toEqual({ error: 2, warning: 1 });
  });

  it('`only` keeps the listed items — a plugin also when one of its servers is listed — and drops the general list', () => {
    const checks = [
      check({ entityUrn: 'urn:skill:a', severity: 'error' }),
      check({ entityUrn: 'urn:mcp:search', category: 'mcp-runtime', target: 'plugin:sp:search' }),
      check({ id: 'collector-error:x', channel: undefined, severity: 'error' }),
    ];
    expect(buildDiagnosticsMatrix({ checks, adapters: on, only: ['urn:skill:a'] }).groups.flatMap((g) => g.rows.map((r) => r.urn))).toEqual(['urn:skill:a']);
    const viaServer = buildDiagnosticsMatrix({ checks, adapters: on, only: ['urn:mcp:search'] });
    expect(viaServer.groups.flatMap((g) => g.rows.map((r) => r.urn))).toEqual(['urn:plugin:sp']);
    expect(viaServer.general).toEqual([]);
  });

  it('ignores checks whose urn is not a customization kind', () => {
    const m = buildDiagnosticsMatrix({ checks: [check({ entityUrn: 'urn:weird:x' })], adapters: on });
    expect(m.groups).toEqual([]);
  });
});
