import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../../../src/shared/session.js';
import { buildFileMarks, relativeToCwd, sessionsUsing, IN_USE_WINDOW_MS } from '../../../src/renderer/lib/session-usage.js';

const session = (over: Partial<SessionSnapshot>): SessionSnapshot =>
  ({ sessionId: 's', label: 'checkout', cwd: '/w', status: 'running', activity: 'working', ...over }) as SessionSnapshot;

describe('session usage helpers', () => {
  it('relativizes against the session cwd and rejects outside paths', () => {
    expect(relativeToCwd('/w/src/a.ts', '/w')).toBe('src/a.ts');
    expect(relativeToCwd('/other/a.ts', '/w')).toBeNull();
    expect(relativeToCwd('/work/a.ts', '/w')).toBeNull();
  });

  it('maps editing and changed files per workspace-relative path', () => {
    const marks = buildFileMarks([session({ editingFile: '/w/a.ts', changedFiles: ['/w/b.ts', '/x/c.ts'] }), session({ status: 'exited', changedFiles: ['/w/z.ts'] })]);
    expect(marks.get('a.ts')).toEqual({ editing: ['checkout'], changed: [] });
    expect(marks.get('b.ts')).toEqual({ editing: [], changed: ['checkout'] });
    expect(marks.has('c.ts')).toBe(false);
    expect(marks.has('z.ts')).toBe(false);
  });

  it('lists sessions that used a customization inside the window only', () => {
    const now = 1_000_000_000;
    const fresh = session({ sessionId: 'a', usedAt: { 'skill:deploy': now - 1000 } });
    const stale = session({ sessionId: 'b', usedAt: { 'skill:deploy': now - IN_USE_WINDOW_MS - 1 } });
    expect(sessionsUsing([fresh, stale], { kind: 'skill', name: 'deploy' }, now).map((s) => s.sessionId)).toEqual(['a']);
  });
});
