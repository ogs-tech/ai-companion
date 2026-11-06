import type { SessionAttention, SessionActivity } from '../../shared/session.js';
import type { SessionSignal } from './ports/session-signal-port.js';

/** Env var the PTY gets; hooks append their JSON line to the file it names. No-op outside the app. */
export const SIGNAL_FILE_ENV = 'AI_COMPANION_SIGNAL_FILE';

const GUARD = `[ -z "$${SIGNAL_FILE_ENV}" ]`;

function simpleHook(event: 'working' | 'idle'): string {
  return `${GUARD} || printf '{"event":"${event}"}\\n' >> "$${SIGNAL_FILE_ENV}"; exit 0`;
}

/** Wraps the hook's stdin JSON (single line) into one signal line. */
const NOTIFICATION_HOOK = `${GUARD} || { printf '{"event":"notification","payload":'; tr -d '\\n\\r'; printf '}\\n'; } >> "$${SIGNAL_FILE_ENV}"; exit 0`;

/** Same wrapping as `notification`, for `PreToolUse`: the payload carries `tool_name`/`tool_input`, which feed the "Edit CartService.ts" detail line. */
const TOOL_HOOK = `${GUARD} || { printf '{"event":"tool","payload":'; tr -d '\\n\\r'; printf '}\\n'; } >> "$${SIGNAL_FILE_ENV}"; exit 0`;

export const SIGNAL_HOOK_COMMANDS = {
  working: simpleHook('working'),
  idle: simpleHook('idle'),
  notification: NOTIFICATION_HOOK,
  tool: TOOL_HOOK,
} as const;

/**
 * Cursor's hooks live in the global `~/.cursor/hooks.json` and `beforeSubmitPrompt`
 * expects a JSON verdict on stdout, so it must answer `continue`.
 */
export const CURSOR_SIGNAL_HOOKS = {
  beforeSubmitPrompt: `${simpleHook('working').replace('; exit 0', '')}; printf '{"continue":true}\\n'; exit 0`,
  stop: SIGNAL_HOOK_COMMANDS.idle,
} as const;

/**
 * The `--settings` JSON handed to `claude` for the app's own sessions. Additive
 * to the user's settings: hooks from every source run side by side.
 * `idle_prompt` notifications are deliberately not subscribed — a session
 * waiting for its next prompt is idle, never needs-input.
 */
export function claudeSignalSettings(): string {
  const run = (command: string) => [{ hooks: [{ type: 'command', command }] }];
  return JSON.stringify({
    hooks: {
      UserPromptSubmit: run(SIGNAL_HOOK_COMMANDS.working),
      // The tool ran, so any permission question was answered.
      PostToolUse: run(SIGNAL_HOOK_COMMANDS.working),
      // Working, plus which tool is running (detail line).
      PreToolUse: run(SIGNAL_HOOK_COMMANDS.tool),
      Stop: run(SIGNAL_HOOK_COMMANDS.idle),
      Notification: [
        { matcher: 'permission_prompt|elicitation_dialog', hooks: [{ type: 'command', command: SIGNAL_HOOK_COMMANDS.notification }] },
      ],
    },
  });
}

/** Parses one line of a signal file; `null` for anything malformed (never throws). */
export function parseSignalLine(line: string): SessionSignal | null {
  const text = line.trim();
  if (text === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const { event, payload } = raw as { event?: unknown; payload?: unknown };
  if (event !== 'working' && event !== 'idle' && event !== 'notification' && event !== 'tool') return null;
  if (event === 'working' || event === 'idle') return { event };
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return { event, payload: payload as Record<string, unknown> };
}

export interface ActivityChange {
  activity: SessionActivity;
  attention?: SessionAttention;
  /** Short "what it is doing now" line while working, e.g. `Edit CartService.ts`. */
  detail?: string;
}

/** Interprets a signal; `null` = ignore it (keep the current state). */
export function interpretSignal(signal: SessionSignal): ActivityChange | null {
  if (signal.event === 'working') return { activity: 'working' };
  if (signal.event === 'idle') return { activity: 'idle' };
  if (signal.event === 'tool') {
    const detail = toolDetail(signal.payload);
    return detail ? { activity: 'working', detail } : { activity: 'working' };
  }
  const type = signal.payload?.['notification_type'];
  const message = signal.payload?.['message'];
  if (type === 'permission_prompt') {
    const detail = typeof message === 'string' ? permissionDetail(message) : undefined;
    return { activity: 'needs-input', attention: detail ? { kind: 'permission', detail } : { kind: 'permission' } };
  }
  if (type === 'elicitation_dialog') return { activity: 'needs-input', attention: { kind: 'question' } };
  // idle_prompt, auth_success, … must never read as "needs you".
  return null;
}

const MAX_DETAIL_CHARS = 60;

/** `PreToolUse` payload → "Edit CartService.ts" / "Bash: npm test" / "Read"; `undefined` when the tool is unknown. */
export function toolDetail(payload: Record<string, unknown> | undefined): string | undefined {
  const tool = payload?.['tool_name'];
  if (typeof tool !== 'string' || tool === '') return undefined;
  const input = payload?.['tool_input'];
  const fields = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const path = fields['file_path'];
  const command = fields['command'];
  let target: string | undefined;
  if (typeof path === 'string' && path !== '') target = path.split('/').pop();
  else if (typeof command === 'string' && command !== '') target = command.replace(/\s+/g, ' ').trim();
  if (!target) return tool;
  const text = typeof command === 'string' && target === command.replace(/\s+/g, ' ').trim() ? `${tool}: ${target}` : `${tool} ${target}`;
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
}

/** "Claude needs your permission to use Bash" → "Bash". */
function permissionDetail(message: string): string | undefined {
  const match = /permission to use (.+?)\.?$/i.exec(message.trim());
  return match?.[1];
}

/**
 * Cursor has no hook for its approval prompt, so this reads the PTY tail. It
 * only matches the CLI's approval chrome ("Waiting for approval…" / the
 * `Run (once) (y)` option) — a miss degrades to working/idle, never a guess.
 */
const CURSOR_APPROVAL = /Waiting for approval|Run \(once\) \(y\)/;
// eslint-disable-next-line no-control-regex -- stripping ANSI escapes is the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export function detectCursorApprovalPrompt(tail: string): boolean {
  return CURSOR_APPROVAL.test(tail.replace(ANSI, ''));
}

/** Bytes the user types to answer a prompt (Enter, a letter/digit, Esc) — not focus/resize reports. */
export function isAnswerInput(data: string): boolean {
  return /[\r\n]/.test(data) || /^[a-zA-Z0-9]$/.test(data) || data === '\u001b';
}
