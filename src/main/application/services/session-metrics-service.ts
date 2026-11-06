import type { SessionSnapshot } from '../../../shared/session.js';
import type { SessionMetrics } from '../../../shared/session-metrics.js';
import type { SessionTranscriptPort } from '../ports/session-transcript-port.js';

export interface SessionMetricsDeps {
  transcripts: Pick<SessionTranscriptPort, 'readLiveMetrics'>;
  sessions: {
    list(): readonly SessionSnapshot[];
    setMetrics(sessionId: string, metrics: SessionMetrics): void;
  };
  /** Minimum gap between two reads of the same session's transcript tail. */
  throttleMs?: number;
}

/**
 * Keeps each running session's cost, context and rate limit current. Driven by
 * the session's own activity events (a turn moving is what makes its transcript
 * grow), never by a timer, and trailing-throttled per session so a tool-heavy
 * turn reads the tail a couple of times rather than once per tool call.
 */
export class SessionMetricsService {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly lastRead = new Map<string, number>();
  private writing = false;

  constructor(private readonly deps: SessionMetricsDeps) {}

  /** Wire to `SessionService.onActivity`. Its own write re-enters here once and is ignored. */
  request(sessionId: string): void {
    if (this.writing || this.pending.has(sessionId)) return;
    const wait = Math.max(0, (this.lastRead.get(sessionId) ?? 0) + (this.deps.throttleMs ?? 2000) - Date.now());
    const timer = setTimeout(() => {
      this.pending.delete(sessionId);
      void this.refresh(sessionId);
    }, wait);
    timer.unref?.();
    this.pending.set(sessionId, timer);
  }

  async refresh(sessionId: string): Promise<void> {
    const session = this.deps.sessions.list().find((s) => s.sessionId === sessionId);
    if (!session) return;
    this.lastRead.set(sessionId, Date.now());
    let metrics: SessionMetrics | null;
    try {
      metrics = await this.deps.transcripts.readLiveMetrics(session.conversationId);
    } catch {
      return; // A transcript mid-write is retried on the next activity event.
    }
    if (!metrics) return;
    this.writing = true;
    try {
      this.deps.sessions.setMetrics(sessionId, metrics);
    } finally {
      this.writing = false;
    }
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}
