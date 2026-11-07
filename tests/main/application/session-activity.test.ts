import { describe, it, expect } from 'vitest';
import {
  claudeSignalSettings,
  detectCursorApprovalPrompt,
  interpretSignal,
  isAnswerInput,
  parseSignalLine,
  SIGNAL_HOOK_COMMANDS,
  toolDetail,
  editedFile,
  toolUsage,
} from '../../../src/main/application/session-activity.js';

describe('parseSignalLine', () => {
  it('parses simple events and notification payloads', () => {
    expect(parseSignalLine('{"event":"working"}')).toEqual({ event: 'working' });
    expect(parseSignalLine('{"event":"notification","payload":{"notification_type":"permission_prompt"}}')).toEqual({
      event: 'notification',
      payload: { notification_type: 'permission_prompt' },
    });
  });

  it.each(['', 'not json', '{"event":"nope"}', '{"event":"notification"}', '{"event":"notification","payload":[]}', '42'])(
    'returns null for %j',
    (line) => {
      expect(parseSignalLine(line)).toBeNull();
    },
  );
});

describe('interpretSignal', () => {
  it('maps working and idle', () => {
    expect(interpretSignal({ event: 'working' })).toEqual({ activity: 'working' });
    expect(interpretSignal({ event: 'idle' })).toEqual({ activity: 'idle' });
  });

  it('maps a permission prompt to needs-input with the tool as detail', () => {
    expect(
      interpretSignal({ event: 'notification', payload: { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } }),
    ).toEqual({ activity: 'needs-input', attention: { kind: 'permission', detail: 'Bash' } });
  });

  it('maps an elicitation dialog to a question', () => {
    expect(interpretSignal({ event: 'notification', payload: { notification_type: 'elicitation_dialog' } })).toEqual({
      activity: 'needs-input',
      attention: { kind: 'question' },
    });
  });

  it('never turns an idle prompt (or anything else) into needs-input', () => {
    expect(interpretSignal({ event: 'notification', payload: { notification_type: 'idle_prompt' } })).toBeNull();
    expect(interpretSignal({ event: 'notification', payload: {} })).toBeNull();
  });
});

describe('detectCursorApprovalPrompt', () => {
  it('matches the approval chrome, through ANSI escapes', () => {
    expect(detectCursorApprovalPrompt('\u001b[1mWaiting for approval...\u001b[0m')).toBe(true);
    expect(detectCursorApprovalPrompt('→ Run (once) (y)')).toBe(true);
  });

  it('does not match ordinary output or an idle prompt', () => {
    expect(detectCursorApprovalPrompt('I will run the tests now\n→ Add a follow-up')).toBe(false);
  });
});

describe('isAnswerInput', () => {
  it('counts Enter, a single key and Esc as answers, not focus reports or pastes', () => {
    expect(isAnswerInput('\r')).toBe(true);
    expect(isAnswerInput('y')).toBe(true);
    expect(isAnswerInput('\u001b')).toBe(true);
    expect(isAnswerInput('\u001b[I')).toBe(false);
  });
});

describe('claudeSignalSettings', () => {
  it('subscribes to the activity hooks but not to idle_prompt', () => {
    const settings = JSON.parse(claudeSignalSettings()) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };
    expect(Object.keys(settings.hooks).sort()).toEqual(['Notification', 'PermissionRequest', 'PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    expect(settings.hooks['Notification']?.[0]?.matcher).toBe('permission_prompt|elicitation_dialog');
    expect(settings.hooks['Stop']?.[0]?.hooks[0]?.command).toBe(SIGNAL_HOOK_COMMANDS.idle);
  });

  it('hook commands are no-ops without the env var', () => {
    for (const command of Object.values(SIGNAL_HOOK_COMMANDS)) expect(command.startsWith('[ -z "$AI_COMPANION_SIGNAL_FILE" ] ||')).toBe(true);
  });
});

describe('tool signals', () => {
  it('turns a PreToolUse payload into a working change with a detail line', () => {
    const signal = parseSignalLine('{"event":"tool","payload":{"tool_name":"Edit","tool_input":{"file_path":"/a/b/CartService.ts"}}}');
    expect(interpretSignal(signal!)).toMatchObject({ activity: 'working', detail: 'Edit CartService.ts' });
  });

  it('shows the command for shell tools and degrades to the bare tool name', () => {
    expect(toolDetail({ tool_name: 'Bash', tool_input: { command: 'npm   test' } })).toBe('Bash: npm test');
    expect(toolDetail({ tool_name: 'Task' })).toBe('Task');
    expect(toolDetail({ tool_input: {} })).toBeUndefined();
  });

  it('wires PreToolUse into the injected settings', () => {
    const settings = JSON.parse(claudeSignalSettings()) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(settings.hooks['PreToolUse']?.[0]?.hooks[0]?.command).toBe(SIGNAL_HOOK_COMMANDS.tool);
  });
});

describe('file and customization signals', () => {
  it('reports the absolute file an editing tool touches', () => {
    const signal = parseSignalLine('{"event":"tool","payload":{"tool_name":"MultiEdit","tool_input":{"file_path":"/w/src/a.ts"}}}');
    expect(interpretSignal(signal!)).toMatchObject({ editingFile: '/w/src/a.ts' });
    expect(editedFile({ tool_name: 'Read', tool_input: { file_path: '/w/a.ts' } })).toBeUndefined();
    expect(editedFile({ tool_name: 'Edit', tool_input: { file_path: 'rel.ts' } })).toBeUndefined();
  });

  it('maps Skill, Task and mcp__ tools to customizations', () => {
    expect(toolUsage({ tool_name: 'Skill', tool_input: { skill: 'deploy' } })).toEqual({ kind: 'skill', name: 'deploy' });
    expect(toolUsage({ tool_name: 'Task', tool_input: { subagent_type: 'reviewer' } })).toEqual({ kind: 'agent', name: 'reviewer' });
    expect(toolUsage({ tool_name: 'mcp__github__create_issue' })).toEqual({ kind: 'mcp', name: 'github' });
    expect(toolUsage({ tool_name: 'Bash' })).toBeUndefined();
  });
});
