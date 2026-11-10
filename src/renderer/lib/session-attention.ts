import type { SessionAttention, SessionSnapshot } from '../../shared/session.js';
import { formatDuration } from './format-session-history.js';

/**
 * What a list row shows. `idle` is a live session stopped at its prompt
 * ("Terminou"); `exited` is a process that is gone ("Encerrada"). The other two
 * map 1:1 to the session's activity.
 */
export type SessionRowState = 'needs-input' | 'working' | 'idle' | 'exited';

/** Chips that filter the list: one per state. */
export type SessionFilter = SessionRowState;

export const SESSION_FILTERS: readonly SessionFilter[] = [
  'needs-input',
  'working',
  'idle',
  'exited',
];

const STATE_ORDER: Record<SessionRowState, number> = {
  'needs-input': 0,
  working: 1,
  idle: 2,
  exited: 3,
};

/**
 * A live session with no activity signal yet is `idle` — never `working`
 * (tokens are not being spent) and never `needs-input`.
 */
export function rowStateOf(live: SessionSnapshot | null): SessionRowState {
  if (!live || live.status !== 'running') return 'exited';
  return live.activity ?? 'idle';
}

/** The most urgent of several states (needs-input > working > idle > exited); `undefined` for none. */
export function mostUrgentState(states: readonly SessionRowState[]): SessionRowState | undefined {
  return states.reduce<SessionRowState | undefined>(
    (best, s) => (best === undefined || STATE_ORDER[s] < STATE_ORDER[best] ? s : best),
    undefined,
  );
}

/** With no filter every session is listed, encerradas last; each chip narrows to one state. */
export function matchesFilter(state: SessionRowState, filter: SessionFilter | null): boolean {
  return filter === null || state === filter;
}

export function countByFilter(states: readonly SessionRowState[]): Record<SessionFilter, number> {
  return {
    'needs-input': states.filter((s) => s === 'needs-input').length,
    working: states.filter((s) => s === 'working').length,
    idle: states.filter((s) => s === 'idle').length,
    exited: states.filter((s) => s === 'exited').length,
  };
}

interface Sortable {
  state: SessionRowState;
  /** Recency, newest = largest. */
  sortAt: number;
  /** When a needs-input row started waiting. */
  waitingSince: number | null;
}

/** State group first; longest-waiting first inside needs-input, newest first elsewhere. */
export function compareRows(a: Sortable, b: Sortable): number {
  if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (a.state === 'needs-input') return (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity);
  return b.sortAt - a.sortAt;
}

/** "há 3min" — how long a session that finished its turn has been waiting at the prompt. */
export function formatIdleFor(sinceMs: number, nowMs: number): string {
  return `há ${formatDuration(Math.max(0, nowMs - sinceMs))}`;
}

/** "precisa de você · 4min" — says in words that the session is blocked on the user, and for how long. */
export function formatWait(sinceMs: number, nowMs: number): string {
  return `precisa de você · ${formatDuration(Math.max(0, nowMs - sinceMs))}`;
}

/** Short pill text for a needs-input row: "Permissão: Bash" / "Permissão" / "Pergunta". */
export function attentionLabel(attention: SessionAttention | undefined): string {
  if (attention?.kind === 'question') return 'Pergunta';
  return attention?.detail ? `Permissão: ${attention.detail}` : 'Permissão';
}

/** What a session's state is about, for a tooltip: the pending permission/question, or the current tool. */
export function sessionStateDetail(live: SessionSnapshot): string | undefined {
  const state = rowStateOf(live);
  if (state === 'needs-input') return attentionLabel(live.attention);
  if (state === 'working') return live.activityDetail;
  return undefined;
}

export const FILTER_LABELS: Record<SessionFilter, string> = {
  'needs-input': 'Pergunta',
  working: 'Trabalhando',
  idle: 'Ocioso',
  exited: 'Fechado',
};

/** Plain-text stand-in for a state's mark, for places that cannot render the SVG (tooltip strings). */
export const FILTER_GLYPHS: Record<SessionFilter, string> = {
  'needs-input': '!',
  working: '✻',
  idle: '◌',
  exited: '⊘',
};
