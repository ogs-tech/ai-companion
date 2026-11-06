import { resolveSessionSettings, type Settings } from '../../../shared/settings.js';
import type { ExternalSession } from '../../../shared/external-session.js';
import type { SessionActivity, SessionSnapshot } from '../../../shared/session.js';
import type { BadgePort, NotificationPort } from '../ports/notification-port.js';

export interface SessionNotifierDeps {
  notification: NotificationPort;
  badge: BadgePort;
  settings: () => Promise<Settings | null>;
  appSessions: () => readonly SessionSnapshot[];
  externalSessions: () => readonly ExternalSession[];
  /** True when the window is focused and this session's tab is the focused one. */
  isFocused: (id: string) => boolean;
  /** Notification clicked: bring the app forward and open this session (or observe the external one). */
  open: (target: { id: string; external: boolean }) => void;
  now: () => number;
}

interface Seen {
  activity: SessionActivity | 'closed';
  since: number;
}

/** A turn longer than this triggers the optional "finished" notification. */
const LONG_TURN_MS = 2 * 60 * 1000;
/** Cost thresholds (US$), each announced once per session. */
const COST_BANDS = [5, 10] as const;
/** Context fraction past which a session is announced once. */
const CONTEXT_ALERT = 0.9;

/**
 * Turns state transitions into OS signals: a native notification on
 * Trabalhando → Pergunta (the only transition that is urgent), an optional one
 * when a long turn ends, and a Dock badge counting Pergunta. A session first
 * seen already in Pergunta is not announced — only a transition is. Every
 * check is a diff against the last seen state, so a re-emitted snapshot with
 * nothing new is silent.
 */
export class SessionNotifier {
  private readonly seen = new Map<string, Seen>();
  /** Highest cost band already announced, per session. */
  private readonly costAnnounced = new Map<string, number>();
  private readonly contextAnnounced = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SessionNotifierDeps) {}

  /** Call on any session or external-session change; evaluations never overlap. */
  evaluate(): Promise<void> {
    this.chain = this.chain.then(() => this.run()).catch(() => {});
    return this.chain;
  }

  /** Cost bands and the context alert, both optional and both announced once per session. */
  private checkMetrics(settings: ReturnType<typeof resolveSessionSettings>): void {
    for (const s of this.deps.appSessions()) {
      if (s.status !== 'running' || !s.metrics) continue;
      const silenced = settings.silenceFocused && this.deps.isFocused(s.sessionId);
      const open = (): void => this.deps.open({ id: s.sessionId, external: false });
      const cost = s.metrics.costUsd;
      if (cost !== undefined) {
        const band = [...COST_BANDS].reverse().find((b) => cost >= b) ?? 0;
        const announced = this.costAnnounced.get(s.sessionId);
        // First sight records the band without announcing: a session resumed already past US$ 5 is not news.
        if (announced === undefined) this.costAnnounced.set(s.sessionId, band);
        else if (band > announced) {
          this.costAnnounced.set(s.sessionId, band);
          if (settings.notifyCost && !silenced) void this.deps.notification.notify({ title: `Sessão passou de US$ ${band}`, body: s.label, onClick: open });
        }
      }
      const { contextTokens, contextWindow } = s.metrics;
      if (contextTokens && contextWindow && contextTokens / contextWindow > CONTEXT_ALERT && !this.contextAnnounced.has(s.sessionId)) {
        this.contextAnnounced.add(s.sessionId);
        if (settings.notifyContext && !silenced) void this.deps.notification.notify({ title: 'Contexto acima de 90%', body: s.label, onClick: open });
      }
    }
  }

  private async run(): Promise<void> {
    const settings = resolveSessionSettings(await this.deps.settings());
    const entries: Array<{ id: string; label: string; activity: SessionActivity | 'closed'; since: number; external: boolean }> = [];
    for (const s of this.deps.appSessions()) {
      entries.push({ id: s.sessionId, label: s.label, activity: s.status === 'running' ? (s.activity ?? 'idle') : 'closed', since: s.activitySince ?? this.deps.now(), external: false });
    }
    if (settings.notifyExternal) {
      for (const s of this.deps.externalSessions()) {
        entries.push({ id: s.id, label: s.label, activity: s.closed ? 'closed' : (s.activity ?? 'idle'), since: s.activitySince ?? this.deps.now(), external: true });
      }
    }

    let asking = 0;
    const live = new Set<string>();
    for (const e of entries) {
      live.add(e.id);
      if (e.activity === 'needs-input') asking += 1;
      const prev = this.seen.get(e.id);
      this.seen.set(e.id, { activity: e.activity, since: e.since });
      if (!prev || prev.activity === e.activity) continue;
      const silenced = settings.silenceFocused && this.deps.isFocused(e.id);
      if (silenced) continue;
      if (e.activity === 'needs-input' && prev.activity === 'working' && settings.notifyAsk) {
        void this.deps.notification.notify({
          title: 'Sessão precisa de você',
          body: `${e.label}${e.external ? ' (externa)' : ''}`,
          onClick: () => this.deps.open({ id: e.id, external: e.external }),
        });
      } else if (prev.activity === 'working' && e.activity === 'idle' && settings.notifyLongTurn && this.deps.now() - prev.since > LONG_TURN_MS) {
        void this.deps.notification.notify({
          title: 'Turno concluído',
          body: e.label,
          onClick: () => this.deps.open({ id: e.id, external: e.external }),
        });
      }
    }
    this.checkMetrics(settings);
    for (const id of [...this.seen.keys()]) if (!live.has(id)) this.seen.delete(id);
    this.deps.badge.setCount(settings.dockBadge ? asking : 0);
  }
}
