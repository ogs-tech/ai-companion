import { usageKey, type SessionSnapshot, type SessionUsage } from '../../shared/session.js';

/** "In use" = invoked in the current turn or within this window (spec: 10 minutes). */
export const IN_USE_WINDOW_MS = 10 * 60 * 1000;

export interface FileMark {
  /** Sessions editing this file right now (labels). */
  editing: string[];
  /** Sessions that changed it this turn (labels). */
  changed: string[];
}

/** `cwd`-relative path of `absolute`, or `null` when it lies outside the session's folder. */
export function relativeToCwd(absolute: string, cwd: string): string | null {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return absolute.startsWith(root) ? absolute.slice(root.length) : null;
}

/** Workspace-relative path → which sessions touch it. Sessions without a hook-reported file contribute nothing. */
export function buildFileMarks(sessions: readonly SessionSnapshot[]): Map<string, FileMark> {
  const marks = new Map<string, FileMark>();
  const entry = (path: string): FileMark => {
    let mark = marks.get(path);
    if (!mark) marks.set(path, (mark = { editing: [], changed: [] }));
    return mark;
  };
  for (const session of sessions) {
    if (session.status !== 'running') continue;
    for (const file of session.changedFiles ?? []) {
      const rel = relativeToCwd(file, session.cwd);
      if (rel !== null) entry(rel).changed.push(session.label);
    }
    if (session.editingFile) {
      const rel = relativeToCwd(session.editingFile, session.cwd);
      if (rel !== null) entry(rel).editing.push(session.label);
    }
  }
  return marks;
}

export interface UsingSession {
  sessionId: string;
  label: string;
  activity: SessionSnapshot['activity'];
}

/** Sessions that used this customization in the last `IN_USE_WINDOW_MS`. */
export function sessionsUsing(sessions: readonly SessionSnapshot[], usage: SessionUsage, now: number): UsingSession[] {
  const key = usageKey(usage);
  return sessions
    .filter((s) => s.status === 'running' && now - (s.usedAt?.[key] ?? -Infinity) <= IN_USE_WINDOW_MS)
    .map((s) => ({ sessionId: s.sessionId, label: s.label, activity: s.activity }));
}
