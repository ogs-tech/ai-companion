import { describe, expect, it } from 'vitest';
import { channelSyncRows } from '../../../src/renderer/lib/channel-sync.js';
import type { HealthCheck } from '../../../src/shared/health.js';

const URN = 'urn:skill:tdd';
const on = { claude: { enabled: true }, cursor: { enabled: true }, lmstudio: { enabled: true } };
const check = (over: Partial<HealthCheck>): HealthCheck => ({
  id: 'c', category: 'symlink', severity: 'ok', title: 't', entityUrn: URN, channel: 'claude', observedAt: '', ...over,
});
const rows = (checks: HealthCheck[], adapters = on, entityEnabled = true) => {
  const view = channelSyncRows({ urn: URN, checks, adapters, entityEnabled });
  if (view.kind !== 'channels') throw new Error('expected channel rows');
  return view.rows;
};
const rowOf = (checks: HealthCheck[], channel: 'claude' | 'cursor' | 'lmstudio', adapters = on) => rows(checks, adapters).find((r) => r.channel === channel);

describe('channelSyncRows', () => {
  it('a covered check reads as the covering channel file, with its path', () => {
    const covered = check({ channel: 'cursor', coveredBy: 'claude', target: '/h/.claude/skills/tdd' });
    expect(rowOf([covered], 'cursor')).toEqual({
      channel: 'cursor', status: 'ok', lines: [{ path: '/h/.claude/skills/tdd', text: 'lê o mesmo arquivo do Claude' }],
    });
  });

  it('lists channels in registry order', () => {
    expect(rows([]).map((r) => r.channel)).toEqual(['claude', 'cursor', 'lmstudio']);
  });

  it('ok symlink check reads as link simbólico with its path', () => {
    expect(rowOf([check({ target: '/home/u/.claude/skills/tdd' })], 'claude')).toEqual({
      channel: 'claude', status: 'ok', lines: [{ path: '/home/u/.claude/skills/tdd', text: 'Ligado por link simbólico' }],
    });
  });

  it('ok generated file reads Arquivo gerado', () => {
    expect(rowOf([check({ category: 'generated-file', channel: 'cursor' })], 'cursor')).toMatchObject({ status: 'ok', lines: [{ text: 'Arquivo gerado' }] });
  });

  it('non-ok check becomes a problem row with remediation', () => {
    const row = rowOf([check({ channel: 'cursor', severity: 'error', title: 'Link quebrado', detail: 'aponta para nada', remediation: 'Sincronize de novo', target: '/x' })], 'cursor');
    expect(row).toEqual({
      channel: 'cursor', status: 'problem', lines: [{ path: '/x', text: 'Link quebrado — aponta para nada', remediation: 'Sincronize de novo' }],
    });
  });

  it('one failing check out of several makes the row a problem, keeping every line', () => {
    const row = rowOf([check({ id: 'a' }), check({ id: 'b', category: 'generated-file', severity: 'warning', title: 'Desatualizado' })], 'claude');
    expect(row?.status).toBe('problem');
    expect(row && 'lines' in row ? row.lines.map((l) => l.text) : []).toEqual(['Ligado por link simbólico', 'Desatualizado']);
  });

  it('merge entry names its file', () => {
    expect(rowOf([check({ category: 'merge-entry', target: '/home/u/.cursor/mcp.json' })], 'claude')).toMatchObject({
      lines: [{ text: 'Entrada em mcp.json' }],
    });
  });

  it('adapter off reads Desativado', () => {
    expect(rowOf([check({ channel: 'cursor' })], 'cursor', { ...on, cursor: { enabled: false } })).toEqual({ channel: 'cursor', status: 'off' });
  });

  it('LM Studio is run-only', () => {
    expect(rowOf([], 'lmstudio')).toEqual({ channel: 'lmstudio', status: 'run-only' });
  });

  it('enabled channel without a check is unchecked', () => {
    expect(rowOf([], 'cursor')).toEqual({ channel: 'cursor', status: 'unchecked' });
  });

  it('disabled entity yields entity-disabled', () => {
    expect(channelSyncRows({ urn: URN, checks: [check({})], adapters: on, entityEnabled: false })).toEqual({ kind: 'entity-disabled' });
  });

  it('checks for other urns are ignored', () => {
    expect(rowOf([check({ entityUrn: 'urn:skill:other' })], 'claude')).toEqual({ channel: 'claude', status: 'unchecked' });
  });
});
