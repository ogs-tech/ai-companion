import { describe, it, expect } from 'vitest';
import {
  attentionLabel,
  compareRows,
  countByFilter,
  formatIdleFor,
  formatWait,
  matchesFilter,
  rowStateOf,
} from '../../../src/renderer/lib/session-attention.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';

const live = (over: Partial<SessionSnapshot>): SessionSnapshot => ({
  sessionId: 's', harness: 'claude', conversationId: 'c', anchor: { kind: 'personal' }, scopeId: null, cwd: '/', label: 'l',
  status: 'running', browserEnabled: false, ...over,
});

describe('rowStateOf', () => {
  it('is exited without a live running session', () => {
    expect(rowStateOf(null)).toBe('exited');
    expect(rowStateOf(live({ status: 'exited', activity: 'working' }))).toBe('exited');
  });
  it('uses the activity, and degrades an unknown one to idle — never working or needs-input', () => {
    expect(rowStateOf(live({ activity: 'needs-input' }))).toBe('needs-input');
    expect(rowStateOf(live({ activity: 'working' }))).toBe('working');
    expect(rowStateOf(live({ activity: 'idle' }))).toBe('idle');
    expect(rowStateOf(live({}))).toBe('idle');
  });
});

describe('filters', () => {
  it('counts one chip per state and lists every row when unfiltered', () => {
    const states = ['needs-input', 'working', 'working', 'idle', 'exited', 'exited'] as const;
    expect(countByFilter(states)).toEqual({ 'needs-input': 1, working: 2, idle: 1, exited: 2 });
    expect(matchesFilter('idle', null)).toBe(true);
    expect(matchesFilter('exited', null)).toBe(true);
    expect(matchesFilter('exited', 'exited')).toBe(true);
    expect(matchesFilter('working', 'idle')).toBe(false);
  });
});

describe('compareRows', () => {
  it('orders by state, longest-waiting first in needs-input, newest first elsewhere', () => {
    const rows = [
      { id: 'exited', state: 'exited', sortAt: 9, waitingSince: null },
      { id: 'work-old', state: 'working', sortAt: 1, waitingSince: null },
      { id: 'need-new', state: 'needs-input', sortAt: 0, waitingSince: 200 },
      { id: 'work-new', state: 'working', sortAt: 5, waitingSince: null },
      { id: 'need-old', state: 'needs-input', sortAt: 0, waitingSince: 100 },
      { id: 'idle', state: 'idle', sortAt: 3, waitingSince: null },
    ] as const;
    expect([...rows].sort(compareRows).map((r) => r.id)).toEqual(['need-old', 'need-new', 'work-new', 'work-old', 'idle', 'exited']);
  });
});

describe('labels', () => {
  it('formats the wait and the reason pill', () => {
    expect(formatWait(0, 4 * 60_000)).toBe('espera 4min');
    expect(formatIdleFor(0, 3 * 60_000)).toBe('há 3min');
    expect(attentionLabel({ kind: 'permission', detail: 'Bash' })).toBe('Permissão: Bash');
    expect(attentionLabel({ kind: 'permission' })).toBe('Permissão');
    expect(attentionLabel({ kind: 'question' })).toBe('Pergunta');
  });
});
