import { describe, it, expect } from 'vitest';
import {
  attentionLabel,
  compareRows,
  countByFilter,
  formatWait,
  matchesFilter,
  rowStateOf,
} from '../../../src/renderer/lib/session-attention.js';
import type { SessionSnapshot } from '../../../src/shared/session.js';

const live = (over: Partial<SessionSnapshot>): SessionSnapshot => ({
  sessionId: 's', harness: 'claude', conversationId: 'c', anchor: { kind: 'personal' }, cwd: '/', label: 'l',
  status: 'running', browserEnabled: false, ...over,
});

describe('rowStateOf', () => {
  it('is exited without a live running session', () => {
    expect(rowStateOf(null)).toBe('exited');
    expect(rowStateOf(live({ status: 'exited', activity: 'working' }))).toBe('exited');
  });
  it('uses the activity, and degrades an unknown one to working — never needs-input', () => {
    expect(rowStateOf(live({ activity: 'needs-input' }))).toBe('needs-input');
    expect(rowStateOf(live({ activity: 'idle' }))).toBe('idle');
    expect(rowStateOf(live({}))).toBe('working');
  });
});

describe('filters', () => {
  it('Concluídas covers idle and exited', () => {
    const states = ['needs-input', 'working', 'working', 'idle', 'exited'] as const;
    expect(countByFilter(states)).toEqual({ 'needs-input': 1, working: 2, done: 2 });
    expect(matchesFilter('idle', 'done')).toBe(true);
    expect(matchesFilter('working', 'done')).toBe(false);
    expect(matchesFilter('working', null)).toBe(true);
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
    expect(attentionLabel({ kind: 'permission', detail: 'Bash' })).toBe('Permissão: Bash');
    expect(attentionLabel({ kind: 'permission' })).toBe('Permissão');
    expect(attentionLabel({ kind: 'question' })).toBe('Pergunta');
  });
});
