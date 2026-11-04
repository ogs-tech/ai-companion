import type { SessionAttention, SessionSnapshot } from '../../shared/session.js';
import { formatDuration } from './format-session-history.js';

/** What a list row shows: the four states of the attention model. */
export type SessionRowState = 'needs-input' | 'working' | 'idle' | 'exited';

/** Chips that filter the list; `done` covers idle and exited alike. */
export type SessionFilter = 'needs-input' | 'working' | 'done';

const STATE_ORDER: Record<SessionRowState, number> = { 'needs-input': 0, working: 1, idle: 2, exited: 3 };

/**
 * A live session with no activity signal yet is `working` — the spec's
 * degrade-to-running rule — never `needs-input`.
 */
export function rowStateOf(live: SessionSnapshot | null): SessionRowState {
  if (!live || live.status !== 'running') return 'exited';
  return live.activity ?? 'working';
}

export function matchesFilter(state: SessionRowState, filter: SessionFilter | null): boolean {
  if (filter === null) return true;
  if (filter === 'done') return state === 'idle' || state === 'exited';
  return state === filter;
}

export function countByFilter(states: readonly SessionRowState[]): Record<SessionFilter, number> {
  return {
    'needs-input': states.filter((s) => s === 'needs-input').length,
    working: states.filter((s) => s === 'working').length,
    done: states.filter((s) => s === 'idle' || s === 'exited').length,
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

/** "espera 4min" */
export function formatWait(sinceMs: number, nowMs: number): string {
  return `espera ${formatDuration(Math.max(0, nowMs - sinceMs))}`;
}

/** Short pill text for a needs-input row: "Permissão: Bash" / "Permissão" / "Pergunta". */
export function attentionLabel(attention: SessionAttention | undefined): string {
  if (attention?.kind === 'question') return 'Pergunta';
  return attention?.detail ? `Permissão: ${attention.detail}` : 'Permissão';
}

export const FILTER_LABELS: Record<SessionFilter, string> = {
  'needs-input': 'Precisa de você',
  working: 'Trabalhando',
  done: 'Concluídas',
};
