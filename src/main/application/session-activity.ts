import { usageKey, type SessionAttention, type SessionPermissionRequest, type SessionActivity, type SessionSnapshot, type SessionUsage } from '../../shared/session.js';
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

/** `SessionStart` (startup/resume/clear/compact): its payload carries the CLI's current `session_id`, which `/clear` replaces. */
const SESSION_START_HOOK = `${GUARD} || { printf '{"event":"session-start","payload":'; tr -d '\\n\\r'; printf '}\\n'; } >> "$${SIGNAL_FILE_ENV}"; exit 0`;

/** Marker the inline-answer setting toggles; absent = the permission hook returns at once and Claude shows its own prompt. */
export const INLINE_ANSWER_MARKER = 'signals/inline-answer-enabled';

/**
 * `PermissionRequest`: publishes the request, then waits (up to ~20 s) for the app to drop
 * `<signal file>.decision` and prints the verdict as the hook's decision JSON. On timeout it
 * prints nothing, so the CLI falls back to its own prompt in the terminal. UNVERIFIED against a
 * real CLI: the output shape and whether the dialog waits for the hook are from the docs.
 */
const PERMISSION_BODY = [
  `[ -f "$HOME/.ai-companion/${INLINE_ANSWER_MARKER}" ] || exit 0`,
  `F="$${SIGNAL_FILE_ENV}"`,
  `rm -f "$F.decision"`,
  `{ printf '{"event":"permission","payload":'; tr -d '\\n\\r'; printf '}\\n'; } >> "$F"`,
  `i=0; while [ $i -lt 100 ]; do if [ -f "$F.decision" ]; then D=$(cat "$F.decision"); rm -f "$F.decision"; ` +
    `if [ "$D" = allow ]; then printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'; ` +
    `elif [ "$D" = deny ]; then printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Negado no AI Companion"}}}'; fi; exit 0; fi; sleep 0.2; i=$((i+1)); done`,
  `exit 0`,
].join('; ');
const PERMISSION_HOOK = `${GUARD} || { ${PERMISSION_BODY}; }; exit 0`;

export const SIGNAL_HOOK_COMMANDS = {
  working: simpleHook('working'),
  idle: simpleHook('idle'),
  notification: NOTIFICATION_HOOK,
  tool: TOOL_HOOK,
  permission: PERMISSION_HOOK,
  sessionStart: SESSION_START_HOOK,
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
      PermissionRequest: [{ hooks: [{ type: 'command', command: SIGNAL_HOOK_COMMANDS.permission, timeout: 30 }] }],
      SessionStart: run(SIGNAL_HOOK_COMMANDS.sessionStart),
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
  if (event !== 'working' && event !== 'idle' && event !== 'notification' && event !== 'tool' && event !== 'permission' && event !== 'session-start') return null; // `session-end` is external-only
  if (event === 'working' || event === 'idle') return { event };
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return { event, payload: payload as Record<string, unknown> };
}

export interface ActivityChange {
  activity: SessionActivity;
  attention?: SessionAttention;
  /** Short "what it is doing now" line while working, e.g. `Edit CartService.ts`. */
  detail?: string;
  /** Absolute path of the file an Edit/Write tool is touching right now. */
  editingFile?: string;
  /** A skill, subagent or MCP server this tool call used. */
  usage?: SessionUsage;
  /** The full permission request (inline answer). */
  permission?: SessionPermissionRequest;
}

/** Interprets a signal; `null` = ignore it (keep the current state). */
export function interpretSignal(signal: SessionSignal): ActivityChange | null {
  if (signal.event === 'session-start' || signal.event === 'session-end') return null;
  if (signal.event === 'working') return { activity: 'working' };
  if (signal.event === 'idle') return { activity: 'idle' };
  if (signal.event === 'permission') {
    const permission = permissionOf(signal.payload);
    return {
      activity: 'needs-input',
      attention: { kind: 'permission', detail: permission?.tool ?? 'permissão' },
      ...(permission ? { permission } : {}),
    };
  }
  if (signal.event === 'tool') {
    const detail = toolDetail(signal.payload);
    const editingFile = editedFile(signal.payload);
    const usage = toolUsage(signal.payload);
    return {
      activity: 'working',
      ...(detail ? { detail } : {}),
      ...(editingFile ? { editingFile } : {}),
      ...(usage ? { usage } : {}),
    };
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

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Absolute path an editing tool is about to change; `undefined` for any other tool or a relative/missing path. */
export function editedFile(payload: Record<string, unknown> | undefined): string | undefined {
  const tool = payload?.['tool_name'];
  if (typeof tool !== 'string' || !FILE_EDIT_TOOLS.has(tool)) return undefined;
  const input = payload?.['tool_input'];
  if (input === null || typeof input !== 'object') return undefined;
  const fields = input as Record<string, unknown>;
  const path = fields['file_path'] ?? fields['notebook_path'];
  return typeof path === 'string' && path.startsWith('/') ? path : undefined;
}

/** `Skill` → the skill, `Task` → the subagent, `mcp__server__tool` → the server; anything else is not a customization. */
export function toolUsage(payload: Record<string, unknown> | undefined): SessionUsage | undefined {
  const tool = payload?.['tool_name'];
  if (typeof tool !== 'string') return undefined;
  const input = payload?.['tool_input'];
  const fields = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (tool === 'Skill') {
    const name = fields['skill'] ?? fields['command'];
    return typeof name === 'string' && name !== '' ? { kind: 'skill', name: name.replace(/^\//, '') } : undefined;
  }
  if (tool === 'Task') {
    const name = fields['subagent_type'];
    return typeof name === 'string' && name !== '' ? { kind: 'agent', name } : undefined;
  }
  const mcp = /^mcp__(.+?)__/.exec(tool);
  return mcp?.[1] ? { kind: 'mcp', name: mcp[1] } : undefined;
}

/** `PermissionRequest` stdin → what the inline answer shows in full: tool, exact command, cwd. */
export function permissionOf(payload: Record<string, unknown> | undefined): SessionPermissionRequest | undefined {
  const tool = payload?.['tool_name'];
  if (typeof tool !== 'string' || tool === '') return undefined;
  const input = payload?.['tool_input'];
  const fields = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const command = fields['command'];
  const path = fields['file_path'];
  const text = typeof command === 'string' ? command : typeof path === 'string' ? path : JSON.stringify(fields);
  const cwd = payload?.['cwd'];
  return { tool, command: text, ...(typeof cwd === 'string' ? { cwd } : {}) };
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

/** The activity-related slice of a session — shared by app-spawned sessions and external ones. */
export type ActivityState = Pick<
  SessionSnapshot,
  'activity' | 'activitySince' | 'attention' | 'activityDetail' | 'editingFile' | 'changedFiles' | 'usedAt' | 'permissionRequest'
>;

function activitySignature(state: ActivityState): string {
  return JSON.stringify([
    state.activity,
    state.attention?.kind,
    state.attention?.detail,
    state.permissionRequest?.command,
    state.activityDetail,
    state.editingFile,
    state.changedFiles?.length ?? 0,
  ]);
}

/**
 * Applies one interpreted signal to `state` in place and returns whether
 * anything the UI shows changed (a no-op signal emits nothing). A bare
 * `working` (PostToolUse) while already working keeps the last tool until the
 * next PreToolUse names a new one; a new turn starts with no changed files;
 * the file being edited joins the turn's changed files as soon as anything
 * else is reported.
 */
export function applyActivityChange(state: ActivityState, incoming: ActivityChange, now: number): boolean {
  let change = incoming;
  if (change.activity === 'working' && change.detail === undefined && state.activity === 'working' && state.activityDetail) {
    change = { ...change, detail: state.activityDetail };
  }
  const before = activitySignature(state);
  if (change.activity === 'working' && state.activity !== 'working') {
    delete state.editingFile;
    delete state.changedFiles;
  }
  if (state.activity !== change.activity) state.activitySince = now;
  state.activity = change.activity;
  if (change.detail) state.activityDetail = change.detail;
  else delete state.activityDetail;
  if (change.attention) state.attention = change.attention;
  else delete state.attention;
  if (state.editingFile && state.editingFile !== change.editingFile) {
    state.changedFiles = [...new Set([...(state.changedFiles ?? []), state.editingFile])];
    delete state.editingFile;
  }
  if (change.permission) state.permissionRequest = change.permission;
  else delete state.permissionRequest;
  if (change.editingFile) state.editingFile = change.editingFile;
  if (change.usage) state.usedAt = { ...state.usedAt, [usageKey(change.usage)]: now };
  return before !== activitySignature(state) || change.usage !== undefined;
}
