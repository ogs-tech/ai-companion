import type { ChannelId } from '../../shared/channel.js';
import { SIGNAL_FILE_ENV } from './session-activity.js';
import type { SessionSignal } from './ports/session-signal-port.js';

/** Directory (under `~/.ai-companion`) hooks of sessions outside the app write to, and its consent marker. */
export const EXTERNAL_SIGNALS_DIR = 'signals/external';
export const EXTERNAL_CONSENT_MARKER = 'signals/external-enabled';

/**
 * One hook command per event for sessions the app did NOT spawn. It no-ops when
 * the app's own signal file is set (the in-app hooks already cover that
 * session) and when the consent marker is absent, so installing it changes
 * nothing until the user accepts. The conversation id comes from the hook's
 * stdin (`session_id` for Claude, `conversation_id` for Cursor); the whole
 * stdin JSON rides along as the payload (cwd, tool_input.file_path, …).
 * `$HOME` expands in the harness's shell, so no path is baked in.
 */
function externalHook(harness: ChannelId, event: 'working' | 'idle' | 'notification' | 'tool' | 'session-start' | 'session-end'): string {
  const dir = `"$HOME/.ai-companion/signals"`;
  return [
    `IN=$(tr -d '\\n\\r')`,
    `[ -n "$${SIGNAL_FILE_ENV}" ] && exit 0`,
    `[ -f ${dir}/external-enabled ] || exit 0`,
    `ID=$(printf '%s' "$IN" | sed -nE 's/.*"(session_id|conversation_id)" *: *"([A-Za-z0-9_-]+)".*/\\2/p')`,
    `[ -n "$ID" ] || exit 0`,
    `mkdir -p ${dir}/external`,
    `printf '{"harness":"${harness}","event":"${event}","payload":%s}\\n' "\${IN:-null}" >> ${dir}/external/"$ID".jsonl`,
    `exit 0`,
  ].join('; ');
}

/** Wrapped in a subshell so Cursor's `beforeSubmitPrompt` never sees our stdout (the in-app entry already answers `continue`). */
const quiet = (command: string): string => `( ${command} ) >/dev/null 2>&1; exit 0`;

export const CLAUDE_EXTERNAL_HOOKS = {
  UserPromptSubmit: quiet(externalHook('claude', 'working')),
  PostToolUse: quiet(externalHook('claude', 'working')),
  PreToolUse: quiet(externalHook('claude', 'tool')),
  Stop: quiet(externalHook('claude', 'idle')),
  Notification: quiet(externalHook('claude', 'notification')),
  // `/clear` ends one conversation and starts another: these two make the app swap them at once instead of waiting for a process scan.
  SessionStart: quiet(externalHook('claude', 'session-start')),
  SessionEnd: quiet(externalHook('claude', 'session-end')),
} as const;

export const CURSOR_EXTERNAL_HOOKS = {
  beforeSubmitPrompt: quiet(externalHook('cursor', 'working')),
  stop: quiet(externalHook('cursor', 'idle')),
} as const;

/** Notifications that mean "blocked on you", same filter the in-app hook uses. */
export const CLAUDE_EXTERNAL_NOTIFICATION_MATCHER = 'permission_prompt|elicitation_dialog';

/** Parses one external signal-file line, keeping the payload for every event (cwd lives there). */
export function parseExternalLine(line: string): { harness: ChannelId; signal: SessionSignal } | null {
  const text = line.trim();
  if (text === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const { harness, event, payload } = raw as { harness?: unknown; event?: unknown; payload?: unknown };
  if (harness !== 'claude' && harness !== 'cursor') return null;
  if (event !== 'working' && event !== 'idle' && event !== 'notification' && event !== 'tool' && event !== 'session-start' && event !== 'session-end') return null;
  const body = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
  if ((event === 'notification' || event === 'tool' || event === 'session-start') && !body) return null;
  return { harness, signal: body ? { event, payload: body } : { event } };
}
