import type { HookEntity } from '../../../shared/entity.js';

/**
 * Claude → Cursor hook translation. Only what Cursor can express is written;
 * anything else is skipped (never degraded — dropping a matcher would make the
 * hook fire on every tool). Event list and matcher semantics:
 * https://cursor.com/docs/agent/hooks (checked 2026-11-02).
 */
const EVENT_MAP: Readonly<Record<string, string>> = {
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

/** Cursor events whose `matcher` filters by tool type. */
const TOOL_MATCHER_EVENTS = new Set(['preToolUse', 'postToolUse', 'postToolUseFailure']);

const TOOL_MAP: Readonly<Record<string, string>> = {
  Bash: 'Shell',
  Read: 'Read',
  Write: 'Write',
  Edit: 'Write',
  MultiEdit: 'Write',
  Grep: 'Grep',
  Task: 'Task',
};

export const CURSOR_HOOKS_VERSION = 1;

export type HookTranslation =
  | { ok: true; event: string; item: Record<string, unknown>; identity: Record<string, unknown> }
  | { ok: false; reason: string };

function translateTool(token: string): string | undefined {
  const mapped = TOOL_MAP[token];
  if (mapped !== undefined) return mapped;
  const mcp = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(token);
  return mcp?.[1] !== undefined ? `MCP:${mcp[1]}` : undefined;
}

function translateMatcher(cursorEvent: string, matcher: string | undefined): { ok: true; value?: string } | { ok: false; reason: string } {
  if (matcher === undefined || matcher === '' || matcher === '*') return { ok: true };
  if (!TOOL_MATCHER_EVENTS.has(cursorEvent)) {
    return { ok: false, reason: `Cursor's '${cursorEvent}' hook has no matcher, so '${matcher}' cannot be expressed` };
  }
  const tokens = matcher.split('|');
  const mapped = tokens.map(translateTool);
  const missing = tokens.filter((_, i) => mapped[i] === undefined);
  if (missing.length > 0) {
    return { ok: false, reason: `matcher '${matcher}' has no Cursor equivalent for: ${missing.join(', ')}` };
  }
  return { ok: true, value: [...new Set(mapped as string[])].join('|') };
}

export function translateHookToCursor(hook: HookEntity): HookTranslation {
  const cursorEvent = EVENT_MAP[hook.event];
  if (cursorEvent === undefined) {
    return { ok: false, reason: `Cursor has no equivalent of the '${hook.event}' event` };
  }
  const handler = hook.handler;
  if (handler['type'] !== 'command' || typeof handler['command'] !== 'string') {
    return { ok: false, reason: `Cursor only receives 'command' hooks (this one is '${String(handler['type'])}')` };
  }
  const matcher = translateMatcher(cursorEvent, hook.matcher);
  if (!matcher.ok) return matcher;

  const command = handler['command'];
  const item: Record<string, unknown> = {
    command,
    ...(matcher.value !== undefined ? { matcher: matcher.value } : {}),
    ...(typeof handler['timeout'] === 'number' ? { timeout: handler['timeout'] } : {}),
  };
  return { ok: true, event: cursorEvent, item, identity: { command, matcher: matcher.value } };
}

const REVERSE_EVENT_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EVENT_MAP).map(([claude, cursor]) => [cursor, claude]),
);
const REVERSE_TOOL_MAP: Readonly<Record<string, string>> = {
  Shell: 'Bash',
  Read: 'Read',
  Write: 'Write|Edit|MultiEdit',
  Grep: 'Grep',
  Task: 'Task',
};

export type HookFromCursor =
  | { ok: true; event: string; matcher?: string; handler: Record<string, unknown> }
  | { ok: false; reason: string };

/** Cursor → Claude shape, for importing a hook found in a Cursor `hooks.json`. */
export function translateHookFromCursor(cursorEvent: string, item: Record<string, unknown>): HookFromCursor {
  const event = REVERSE_EVENT_MAP[cursorEvent];
  if (event === undefined) return { ok: false, reason: `No Claude equivalent of Cursor's '${cursorEvent}' event` };
  const command = item['command'];
  if (typeof command !== 'string' || (item['type'] !== undefined && item['type'] !== 'command')) {
    return { ok: false, reason: 'Only command hooks can be imported' };
  }
  let matcher: string | undefined;
  const raw = item['matcher'];
  if (typeof raw === 'string' && raw !== '' && raw !== '*') {
    if (!TOOL_MATCHER_EVENTS.has(cursorEvent)) {
      return { ok: false, reason: `Cannot map the matcher '${raw}' of '${cursorEvent}'` };
    }
    const parts: string[] = [];
    for (const token of raw.split('|')) {
      const mcp = /^MCP:(.+)$/.exec(token);
      const mapped = REVERSE_TOOL_MAP[token] ?? (mcp?.[1] !== undefined ? `mcp__.*__${mcp[1]}` : undefined);
      if (mapped === undefined) return { ok: false, reason: `Cannot map the matcher token '${token}'` };
      parts.push(mapped);
    }
    matcher = parts.join('|');
  }
  return {
    ok: true,
    event,
    ...(matcher !== undefined ? { matcher } : {}),
    handler: { type: 'command', command, ...(typeof item['timeout'] === 'number' ? { timeout: item['timeout'] } : {}) },
  };
}
