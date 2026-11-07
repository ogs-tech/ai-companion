import { basename } from 'node:path';
import type { HarnessId } from '../../../shared/harness.js';
import {
  EXTERNAL_SCAN_HIDDEN_MS,
  EXTERNAL_SCAN_VISIBLE_MS,
  EXTERNAL_TAIL_BYTES,
  EXTERNAL_WORKING_WINDOW_MS,
  type ExternalSession,
} from '../../../shared/external-session.js';
import type {
  ExternalSignal,
  ExternalSignalSourcePort,
  LiveProcess,
  ProcessScanPort,
  TranscriptChange,
  TranscriptWatchPort,
} from '../ports/external-session-ports.js';
import { applyActivityChange, interpretSignal } from '../session-activity.js';

export interface ExternalSessionDeps {
  signals: ExternalSignalSourcePort;
  transcripts: TranscriptWatchPort;
  processes: ProcessScanPort;
  now: () => number;
  /** Ids of conversations the app itself runs; never listed as external. */
  isOwnConversation: (id: string) => boolean;
}

/** A hook-reported session with no live process this long after its last signal is closed. */
const CLOSE_GRACE_MS = 10_000;

/**
 * Sessions running outside the app, from three event-driven sources ordered by
 * precision: hook signal files (measured), transcript growth (estimated) and
 * the process list (liveness, terminal label; the only source for Cursor with
 * no hooks, where it can say Ocioso at most — never Pergunta).
 *
 * Pure of Electron: sources arrive through ports, time through `now`.
 */
export class ExternalSessionService {
  private readonly sessions = new Map<string, ExternalSession>();
  private readonly listeners: Array<() => void> = [];
  private readonly settleTimers = new Map<string, NodeJS.Timeout>();
  /** Conversations a `SessionEnd` hook closed: a still-exiting process must not revive them; only a new signal does. */
  private readonly ended = new Set<string>();
  private scanTimer: NodeJS.Timeout | undefined;
  private visible = true;
  private mode: 'off' | 'exact' | 'estimated' = 'off';

  constructor(private readonly deps: ExternalSessionDeps) {
    deps.signals.onSignal((signal) => this.onSignal(signal));
    deps.transcripts.onChange((change) => this.onTranscript(change));
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  list(): ExternalSession[] {
    // A `/clear` in an app session can register its new conversation here before the app learns the id; hide it.
    return [...this.sessions.values()].filter((s) => !this.deps.isOwnConversation(s.id));
  }

  /** `off` stops every watcher and timer (the feature costs nothing); `exact` also listens to hook files; `estimated` only reads transcripts and processes. */
  async setMode(mode: 'off' | 'exact' | 'estimated'): Promise<void> {
    this.mode = mode;
    this.deps.signals.stop();
    this.deps.transcripts.stop();
    this.stopScanning();
    if (mode === 'off') {
      this.sessions.clear();
      this.emit();
      return;
    }
    if (mode === 'exact') await this.deps.signals.start();
    await this.deps.transcripts.start();
    this.scheduleScan();
  }

  /** Window visibility only slows the process scan; it never pauses the watchers. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.mode !== 'off') this.scheduleScan();
  }

  tail(id: string): Promise<string> {
    return this.deps.transcripts.tail(id, EXTERNAL_TAIL_BYTES);
  }

  /** Runs one process scan now (also what the timer does). */
  async scanProcesses(): Promise<void> {
    if (this.mode === 'off') return;
    const live = await this.deps.processes.scan();
    const now = this.deps.now();
    let changed = false;
    const claimed = new Set<LiveProcess>();

    // Pass 1: command lines that name the conversation. Pass 2: an id-less process serves ONE session in its cwd (the most recently active), so a single live process cannot keep every old transcript in that folder open.
    const matched = new Map<ExternalSession, LiveProcess>();
    const open = [...this.sessions.values()].filter((s) => !this.ended.has(s.id));
    for (const session of open) {
      const byId = live.find((p) => p.conversationId === session.id);
      if (byId) {
        matched.set(session, byId);
        claimed.add(byId);
      }
    }
    const byRecency = open.filter((s) => !matched.has(s)).sort((a, b) => b.lastEventAt - a.lastEventAt);
    for (const session of byRecency) {
      if (!session.cwd) continue;
      const byCwd = live.find((p) => !claimed.has(p) && p.harness === session.harness && p.cwd === session.cwd && p.conversationId === null);
      if (byCwd) {
        matched.set(session, byCwd);
        claimed.add(byCwd);
      }
    }

    for (const session of open) {
      const process = matched.get(session);
      if (process) {
        const terminal = process.terminal ?? undefined;
        if (session.closed || session.terminal !== terminal) {
          session.closed = false;
          if (terminal) session.terminal = terminal;
          changed = true;
        }
      } else if (!session.closed && now - session.lastEventAt > CLOSE_GRACE_MS) {
        this.close(session);
        changed = true;
      }
    }

    // A live process nobody reported: a hookless Cursor (or Claude before its first event) — Ocioso, estimated, never Pergunta.
    for (const process of live) {
      if (claimed.has(process) || this.isKnown(process)) continue;
      const id = process.conversationId ?? `${process.harness}-proc:${process.pid}`;
      if (this.deps.isOwnConversation(id)) continue;
      this.sessions.set(id, this.create(id, process.harness, process.cwd, 'estimated', now, process.terminal ?? undefined));
      changed = true;
    }
    if (changed) this.emit();
  }

  dispose(): void {
    this.stopScanning();
    for (const timer of this.settleTimers.values()) clearTimeout(timer);
    this.settleTimers.clear();
  }

  private onSignal({ harness, id, signal }: ExternalSignal): void {
    if (this.deps.isOwnConversation(id)) return;
    const now = this.deps.now();
    if (signal.event === 'session-end') {
      this.endSession(id, now, signal.payload?.['reason'] === 'clear');
      return;
    }
    const known = this.sessions.has(id);
    // A fresh conversation (startup, `/clear`) is idle until its first prompt. On a known one — resume, `/compact` mid-turn — it only proves it is alive.
    const change = signal.event === 'session-start' ? (known ? null : ({ activity: 'idle' } as const)) : interpretSignal(signal);
    if (!change && signal.event !== 'session-start') return;
    const cwd = cwdOf(signal.payload);
    this.ended.delete(id);
    let session = this.sessions.get(id);
    if (!session) {
      session = this.create(id, harness, cwd, 'measured', now);
      this.sessions.set(id, session);
    }
    session.precision = 'measured';
    session.closed = false;
    session.lastEventAt = now;
    if (cwd && !session.cwd) {
      session.cwd = cwd;
      session.label = basename(cwd);
    }
    this.cancelSettle(id);
    if (change) applyActivityChange(session, change, now);
    this.emit();
  }

  /** A `/clear` is a swap, not an exit: the old conversation leaves the list so only the fresh idle one remains instead of a closed row piling up per clear. */
  private endSession(id: string, now: number, replaced: boolean): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.ended.add(id);
    if (replaced) {
      this.cancelSettle(id);
      this.sessions.delete(id);
      this.emit();
      return;
    }
    applyActivityChange(session, { activity: 'idle' }, now);
    this.close(session);
    this.emit();
  }

  /** Estimated state from a transcript write: modified within the window = working; it settles to idle when the window passes without another write. */
  private onTranscript({ id, harness, cwd, modifiedAt, title }: TranscriptChange): void {
    if (this.deps.isOwnConversation(id)) return;
    const existing = this.sessions.get(id);
    // A hook already reports this one exactly; the transcript only adds its title.
    if (existing?.precision === 'measured') {
      if (title && existing.title !== title) {
        existing.title = title;
        this.emit();
      }
      return;
    }
    const now = this.deps.now();
    if (this.ended.has(id)) return;
    const session = existing ?? this.create(id, harness, cwd, 'estimated', now);
    if (!existing) this.sessions.set(id, session);
    if (title) session.title = title;
    if (cwd && !session.cwd) {
      session.cwd = cwd;
      session.label = basename(cwd);
    }
    session.closed = false;
    session.lastEventAt = now;
    const fresh = now - modifiedAt <= EXTERNAL_WORKING_WINDOW_MS;
    this.cancelSettle(id);
    if (fresh) {
      applyActivityChange(session, { activity: 'working' }, now);
      this.settleTimers.set(
        id,
        setTimeout(() => {
          this.settleTimers.delete(id);
          const current = this.sessions.get(id);
          if (!current || current.precision === 'measured') return;
          applyActivityChange(current, { activity: 'idle' }, this.deps.now());
          this.emit();
        }, EXTERNAL_WORKING_WINDOW_MS),
      );
    } else {
      applyActivityChange(session, { activity: 'idle' }, now);
    }
    this.emit();
  }

  private create(id: string, harness: HarnessId, cwd: string | null, precision: ExternalSession['precision'], now: number, terminal?: string): ExternalSession {
    return {
      id,
      harness,
      cwd,
      label: cwd ? basename(cwd) : id.slice(0, 8),
      closed: false,
      precision,
      lastEventAt: now,
      activity: 'idle',
      activitySince: now,
      ...(terminal ? { terminal } : {}),
    };
  }

  private close(session: ExternalSession): void {
    session.closed = true;
    delete session.attention;
    delete session.activityDetail;
    delete session.editingFile;
    this.cancelSettle(session.id);
  }

  private isKnown(process: LiveProcess): boolean {
    for (const session of this.sessions.values()) {
      if (session.harness !== process.harness) continue;
      if (process.conversationId !== null ? session.id === process.conversationId : session.cwd !== null && session.cwd === process.cwd) return true;
    }
    return false;
  }

  private cancelSettle(id: string): void {
    const timer = this.settleTimers.get(id);
    if (timer) clearTimeout(timer);
    this.settleTimers.delete(id);
  }

  /** Scan only while there is something to confirm (any non-closed candidate or a mode that can discover), slower when the window is hidden. */
  private scheduleScan(): void {
    this.stopScanning();
    if (this.mode === 'off') return;
    const delay = this.visible ? EXTERNAL_SCAN_VISIBLE_MS : EXTERNAL_SCAN_HIDDEN_MS;
    this.scanTimer = setTimeout(() => {
      void this.scanProcesses()
        .catch(() => {})
        .finally(() => this.scheduleScan());
    }, delay);
    this.scanTimer.unref?.();
  }

  private stopScanning(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = undefined;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function cwdOf(payload: Record<string, unknown> | undefined): string | null {
  const cwd = payload?.['cwd'];
  if (typeof cwd === 'string' && cwd.startsWith('/')) return cwd;
  const roots = payload?.['workspace_roots'];
  const first = Array.isArray(roots) ? roots[0] : undefined;
  return typeof first === 'string' && first.startsWith('/') ? first : null;
}
