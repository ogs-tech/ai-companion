import { randomUUID } from 'node:crypto';
import type { SessionAnchor, SessionSnapshot, SessionSnapshotWithOutput, SessionStatus } from '../../../shared/session.js';
import { sessionAnchorKey } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeSessionPort } from '../ports/claude-session-port.js';
import type { WorkspaceService } from './workspace-service.js';
import type { ProjectService } from './project-service.js';
import { resolveScopePath } from '../resolve-scope-path.js';
import { DomainError, ioError } from '../../domain/errors.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** Scrollback kept per anchor so a reattaching SessionPanel can replay what it missed — in memory only, capped, never persisted to disk. */
const DEFAULT_MAX_BUFFER_CHARS = 200_000;

export type SessionOutputListener = (sessionId: string, chunk: string) => void;
export type SessionStatusListener = (sessionId: string, status: SessionStatus, exitCode: number) => void;

/**
 * Session identity is kind-conditional. `entity` anchors keep the original
 * one-live-session invariant: `sessionId` is always `sessionAnchorKey(anchor)`,
 * `spawn` dedupes against a running session and relaunches an exited one in
 * place. `workspace`/`project` anchors coexist instead — every `spawn` mints
 * a fresh `crypto.randomUUID()` and starts a brand-new PTY, so multiple
 * sessions can be live for the same workspace/project at once; `resume`
 * relaunches one specific, already-known `sessionId` (of any anchor kind)
 * without minting a new one.
 */
export class SessionService {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly pending = new Map<string, Promise<SessionSnapshotWithOutput>>();
  private readonly outputListeners: SessionOutputListener[] = [];
  private readonly exitListeners: SessionStatusListener[] = [];
  private readonly outputBuffers = new Map<string, string[]>();
  private readonly maxBufferChars: number;
  /** Per-anchor count of `workspace`/`project` sessions ever spawned — numbers the label suffix, never reused even after that session is removed. */
  private readonly ordinals = new Map<string, number>();

  constructor(
    private readonly entityService: EntityService,
    private readonly claudeSession: ClaudeSessionPort,
    private readonly workspacePath: string,
    private readonly scopeDeps: {
      workspaceService: Pick<WorkspaceService, 'get'>;
      projectService: Pick<ProjectService, 'get'>;
    },
    options?: { maxBufferChars?: number },
  ) {
    this.maxBufferChars = options?.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    this.claudeSession.onData((sessionId, chunk) => {
      this.appendToBuffer(sessionId, chunk);
      for (const listener of this.outputListeners) listener(sessionId, chunk);
    });
    this.claudeSession.onExit((sessionId, exitCode) => {
      const session = this.sessions.get(sessionId);
      if (session) session.status = 'exited';
      for (const listener of this.exitListeners) listener(sessionId, 'exited', exitCode);
    });
  }

  private appendToBuffer(sessionId: string, chunk: string): void {
    const buf = this.outputBuffers.get(sessionId) ?? [];
    buf.push(chunk);
    let total = buf.reduce((n, c) => n + c.length, 0);
    while (total > this.maxBufferChars) {
      const head = buf[0]!;
      const excess = total - this.maxBufferChars;
      if (head.length <= excess) {
        buf.shift();
        total -= head.length;
      } else {
        buf[0] = head.slice(excess);
        total -= excess;
      }
    }
    this.outputBuffers.set(sessionId, buf);
  }

  private withOutput(session: SessionSnapshot): SessionSnapshotWithOutput {
    return { ...session, outputBuffer: (this.outputBuffers.get(session.sessionId) ?? []).join('') };
  }

  async spawn(anchor: SessionAnchor): Promise<SessionSnapshotWithOutput> {
    if (anchor.kind !== 'entity') return this.launch(randomUUID(), anchor);

    const sessionId = sessionAnchorKey(anchor);
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status === 'running') return this.withOutput(existing);

    const pendingSpawn = this.pending.get(sessionId);
    if (pendingSpawn) return pendingSpawn;

    const spawnPromise = this.launch(sessionId, anchor).finally(() => {
      this.pending.delete(sessionId);
    });
    this.pending.set(sessionId, spawnPromise);
    return spawnPromise;
  }

  /**
   * Relaunches the PTY for one already-known `sessionId` in place, whatever
   * its anchor kind — it operates purely on that entry's stored
   * `anchor`/`cwd`/`label`, not on identity rules like `spawn`'s. Idempotent
   * while running (mirrors `spawn`'s guard) and single-flight against
   * concurrent calls (sharing `spawn`'s own `pending` map, keyed by the same
   * `sessionId`) while relaunching, so a double-click can't spawn two PTYs
   * under one id; never bumps the anchor's ordinal counter, since it
   * restarts an existing slot rather than minting a new one.
   */
  async resume(sessionId: string): Promise<SessionSnapshotWithOutput> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new DomainError('not_found', `Unknown session '${sessionId}'`, { sessionId });
    }
    if (existing.status === 'running') return this.withOutput(existing);

    const pendingResume = this.pending.get(sessionId);
    if (pendingResume) return pendingResume;

    const resumePromise = (async () => {
      // Relaunching a session that already had its own conversation — continue it.
      await this.spawnPty(sessionId, existing.cwd, { continueConversation: true });
      existing.status = 'running';
      return this.withOutput(existing);
    })().finally(() => {
      this.pending.delete(sessionId);
    });
    this.pending.set(sessionId, resumePromise);
    return resumePromise;
  }

  private async launch(sessionId: string, anchor: SessionAnchor): Promise<SessionSnapshotWithOutput> {
    const { cwd, label } = await this.resolveAnchor(anchor);
    const finalLabel = anchor.kind === 'entity' ? label : this.nextOrdinalLabel(anchor, label);

    // `entity` keeps trying to continue that anchor's own prior conversation
    // (unchanged, one-session-per-anchor behavior). `workspace`/`project`
    // always starts clean — with several sessions now able to coexist in
    // the same cwd, `--continue` could attach to a sibling session's
    // conversation instead of starting the fresh one the user asked for.
    await this.spawnPty(sessionId, cwd, { continueConversation: anchor.kind === 'entity' });

    const session: SessionSnapshot = { sessionId, anchor, cwd, label: finalLabel, status: 'running' };
    this.sessions.set(sessionId, session);
    return this.withOutput(session);
  }

  private async spawnPty(sessionId: string, cwd: string, opts: { continueConversation: boolean }): Promise<void> {
    try {
      await this.claudeSession.spawn(sessionId, cwd, {
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        continueConversation: opts.continueConversation,
      });
    } catch (err) {
      throw ioError({
        message: `Failed to start a claude session: ${(err as Error).message}`,
        details: { reason: 'claude_session_spawn_failed' },
      });
    }
  }

  /** First session for an anchor keeps the plain label; each later one gets a numbered suffix, computed once at spawn time. */
  private nextOrdinalLabel(anchor: SessionAnchor, baseLabel: string): string {
    const key = sessionAnchorKey(anchor);
    const ordinal = (this.ordinals.get(key) ?? 0) + 1;
    this.ordinals.set(key, ordinal);
    return ordinal === 1 ? baseLabel : `${baseLabel} (${ordinal})`;
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    this.claudeSession.write(sessionId, data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    this.claudeSession.resize(sessionId, cols, rows);
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    this.claudeSession.kill(sessionId);
    session.status = 'exited';
  }

  /**
   * Kills the session if it's still running, then forgets it entirely —
   * unlike `kill`, which leaves an 'exited' entry behind for `list`/`status`
   * to keep reporting. Safe to call on an already-exited or unknown
   * `sessionId`: it just purges whatever is there (or no-ops).
   */
  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.status === 'running') this.claudeSession.kill(sessionId);
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
  }

  status(sessionId: string): SessionSnapshotWithOutput | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.withOutput(session) : undefined;
  }

  /** All sessions in this workspace's memory, running and exited alike — never persisted, never pruned. */
  list(): SessionSnapshot[] {
    return Array.from(this.sessions.values());
  }

  killAll(): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'running') {
        this.claudeSession.kill(sessionId);
        session.status = 'exited';
      }
    }
  }

  onOutput(listener: SessionOutputListener): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: SessionStatusListener): void {
    this.exitListeners.push(listener);
  }

  private async resolveAnchor(anchor: SessionAnchor): Promise<{ cwd: string; label: string }> {
    if (anchor.kind === 'workspace') {
      const workspace = await this.scopeDeps.workspaceService.get(anchor.workspaceId);
      return { cwd: workspace.rootPath, label: workspace.name };
    }
    if (anchor.kind === 'project') {
      const project = await this.scopeDeps.projectService.get(anchor.projectId);
      return { cwd: project.path, label: project.name };
    }
    const entity = await this.entityService.get(anchor.urn);
    const cwd = entity.scopes[0] !== 'personal' ? await resolveScopePath(entity, this.scopeDeps) : this.workspacePath;
    return { cwd, label: entity.name };
  }
}
