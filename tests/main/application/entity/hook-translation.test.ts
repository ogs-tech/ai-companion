import { describe, expect, it } from 'vitest';
import { translateHookToCursor } from '../../../../src/main/application/entity/hook-translation.js';
import type { HookEntity } from '../../../../src/shared/entity.js';

const hook = (over: Partial<HookEntity>): HookEntity => ({
  urn: 'urn:hook:h', kind: 'hook', name: 'h', description: '', scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' }, source: { kind: 'workspace' },
  event: 'PreToolUse', handler: { type: 'command', command: './c.sh' }, enabled: true, ...over,
});

describe('translateHookToCursor', () => {
  it('maps event and tool matcher', () => {
    const r = translateHookToCursor(hook({ matcher: 'Bash|Edit', handler: { type: 'command', command: './c.sh', timeout: 5 } }));
    expect(r).toEqual({
      ok: true, event: 'preToolUse',
      item: { command: './c.sh', matcher: 'Shell|Write', timeout: 5 },
      identity: { command: './c.sh', matcher: 'Shell|Write' },
    });
  });
  it('maps MCP tool names', () => {
    const r = translateHookToCursor(hook({ matcher: 'mcp__github__create_issue' }));
    expect(r.ok && r.item['matcher']).toBe('MCP:create_issue');
  });
  it('treats * and empty matcher as none', () => {
    const r = translateHookToCursor(hook({ event: 'Stop', matcher: '*' }));
    expect(r.ok && r.item).toEqual({ command: './c.sh' });
  });
  it('skips events Cursor lacks', () => {
    expect(translateHookToCursor(hook({ event: 'Notification' }))).toMatchObject({ ok: false });
  });
  it('skips untranslatable matchers instead of dropping them', () => {
    expect(translateHookToCursor(hook({ matcher: 'WebFetch' }))).toMatchObject({ ok: false });
    expect(translateHookToCursor(hook({ event: 'SessionStart', matcher: 'startup' }))).toMatchObject({ ok: false });
  });
  it('skips non-command handlers', () => {
    expect(translateHookToCursor(hook({ handler: { type: 'prompt', prompt: 'x' } }))).toMatchObject({ ok: false });
  });
});
