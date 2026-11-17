/**
 * Claude hook events the app can carry to every channel, with Cursor's name for each (https://cursor.com/docs/agent/hooks,
 * checked 2026-11-02). The hook editor offers exactly these; `hook-translation.ts` translates with the same map.
 */
export const CLAUDE_TO_CURSOR_HOOK_EVENT: Readonly<Record<string, string>> = {
  SessionStart: 'sessionStart',
  SessionEnd: 'sessionEnd',
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  PostToolUseFailure: 'postToolUseFailure',
  SubagentStart: 'subagentStart',
  SubagentStop: 'subagentStop',
  UserPromptSubmit: 'beforeSubmitPrompt',
  PreCompact: 'preCompact',
  Stop: 'stop',
};

export const SUPPORTED_HOOK_EVENTS: readonly string[] = Object.keys(CLAUDE_TO_CURSOR_HOOK_EVENT);
