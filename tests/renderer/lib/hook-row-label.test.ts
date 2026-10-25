import { describe, it, expect } from 'vitest';
import { hookRowLabel } from '../../../src/renderer/lib/describe-hook-handler.js';

describe('hookRowLabel', () => {
  it('shows Event · script name for a command hook, without directories or extension', () => {
    const handler = { type: 'command' as const, command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' };
    expect(hookRowLabel({ event: 'PreToolUse', handler })).toBe('PreToolUse · run-hook');
  });

  it('falls back to the first token when the command has no path', () => {
    expect(hookRowLabel({ event: 'Stop', handler: { type: 'command', command: 'echo hi' } })).toBe('Stop · echo');
  });

  it('describes non-command handlers in full', () => {
    expect(hookRowLabel({ event: 'Stop', handler: { type: 'http', url: 'https://x.dev/h' } })).toBe('Stop · HTTP → https://x.dev/h');
  });
});
