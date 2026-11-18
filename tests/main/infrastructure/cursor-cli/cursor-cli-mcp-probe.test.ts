import { describe, expect, it } from 'vitest';
import { parseCursorMcpList } from '../../../../src/main/infrastructure/cursor-cli/cursor-cli-mcp-probe.js';

describe('parseCursorMcpList', () => {
  it('maps every status cursor-agent prints, leaving out the ones that say nothing about the connection', () => {
    const out = [
      'linear: requires_authentication',
      'gh: ready',
      'fs: Error: spawn fs-mcp ENOENT',
      'new: not loaded (needs approval)',
      'slow: loading',
      'off: disabled',
      '',
    ].join('\n');
    const health = parseCursorMcpList(out);
    expect(Object.fromEntries(health)).toEqual({
      linear: { state: 'needs-auth' },
      gh: { state: 'ok' },
      fs: { state: 'error', detail: 'spawn fs-mcp ENOENT' },
      new: { state: 'warning', detail: 'Aguardando aprovação no Cursor' },
    });
  });

  it('strips the colours it adds on a TTY and ignores the empty-config message', () => {
    expect(parseCursorMcpList('\u001b[32mready\u001b[39m').size).toBe(0);
    expect(
      Object.fromEntries(parseCursorMcpList('monday: \u001b[33mrequires_authentication\u001b[39m')),
    ).toEqual({ monday: { state: 'needs-auth' } });
    expect(
      parseCursorMcpList(
        'No MCP servers configured (expected in .cursor/mcp.json or ~/.cursor/mcp.json)',
      ).size,
    ).toBe(0);
  });
});
