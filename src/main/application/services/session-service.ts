import { randomUUID } from 'node:crypto';
import type { SessionAnchor, SessionSnapshot, SessionSnapshotWithOutput, SessionStatus } from '../../../shared/session.js';
import { sessionAnchorKey } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeConversationTarget, ClaudeSessionPort } from '../ports/claude-session-port.js';
import type { EmbeddedBrowserPort } from '../ports/embedded-browser-port.js';
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
 *
 * Orthogonal to all of that, every session also carries a `claudeSessionId`:
 * a UUID minted once, handed to the CLI, and never re-minted for that
 * session again — relaunching a session resumes its conversation instead of
 * starting a second one. That id is what ties a session to its transcript
 * on disk, and so to its entry (and cost) in the session history.
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
  /**
   * The `--mcp-config` path handed back by `embeddedBrowser.create` for each
   * `browserEnabled` session — survives `kill` (so a `resume` reuses the same
   * file instead of regenerating it) and is only cleared by `disable` or
   * `remove`, the only two calls that actually tear the view down.
   */
  private readonly browserMcpConfigPaths = new Map<string, string>();

  constructor(
    private readonly entityService: EntityService,
    private readonly claudeSession: ClaudeSessionPort,
    private readonly embeddedBrowser: EmbeddedBrowserPort,
    private readonly workspacePath: string,
    private readonly scopeDeps: {
      workspaceService: Pick<WorkspaceService, 'get'>;
      projectService: Pick<ProjectService, 'get' | 'findOrCreateByPath'>;
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
      // Relaunching a session that already had its own conversation — reattach
      // to that exact one by id, not to whatever this cwd last talked to.
      await this.spawnPty(sessionId, existing.cwd, {
        mode: 'resume',
        claudeSessionId: existing.claudeSessionId,
      });
      existing.status = 'running';
      return this.withOutput(existing);
    })().finally(() => {
      this.pending.delete(sessionId);
    });
    this.pending.set(sessionId, resumePromise);
    return resumePromise;
  }

  /**
   * Adopts a conversation that exists on disk but not in this process's
   * memory — one from a past run of the app, or started in a plain terminal —
   * and registers it as an ordinary session, indistinguishable from any other
   * from that point on.
   *
   * Its `sessionId` is the `claudeSessionId` itself: a UUID, so it can't
   * collide with an entity anchor's key, and stable, so adopting the same
   * conversation twice reattaches rather than forking it.
   *
   * Registers `cwd` as a project if it isn't one already — a live session has
   * to be anchored somewhere, and the directory the conversation actually ran
   * in is the only honest answer.
   */
  async adoptConversation(input: {
    claudeSessionId: string;
    cwd: string;
    label: string;
  }): Promise<SessionSnapshotWithOutput> {
    const sessionId = input.claudeSessionId;
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status === 'running') return this.withOutput(existing);

    const pendingAdopt = this.pending.get(sessionId);
    if (pendingAdopt) return pendingAdopt;

    const adoptPromise = (async () => {
      const project = await this.scopeDeps.projectService.findOrCreateByPath(input.cwd);
      await this.spawnPty(sessionId, input.cwd, {
        mode: 'resume',
        claudeSessionId: input.claudeSessionId,
      });
      const session: SessionSnapshot = {
        sessionId,
        claudeSessionId: input.claudeSessionId,
        anchor: { kind: 'project', projectId: project.id },
        cwd: input.cwd,
        label: input.label,
        status: 'running',
        browserEnabled: false,
      };
      this.sessions.set(sessionId, session);
      return this.withOutput(session);
    })().finally(() => {
      this.pending.delete(sessionId);
    });
    this.pending.set(sessionId, adoptPromise);
    return adoptPromise;
  }

  private async launch(sessionId: string, anchor: SessionAnchor): Promise<SessionSnapshotWithOutput> {
    const { cwd, label } = await this.resolveAnchor(anchor);
    // Only an `entity` anchor can land here with a prior entry: its sessionId
    // is the anchor key, so reopening an exited one reuses the same slot.
    // `workspace`/`project` arrive with a freshly minted sessionId every time.
    const previous = this.sessions.get(sessionId);
    const finalLabel =
      previous?.label ?? (anchor.kind === 'entity' ? label : this.nextOrdinalLabel(anchor, label));
    // Reopening keeps the conversation it already had; a genuinely new
    // session names a brand-new one. Either way the id is ours, not the
    // CLI's, so the transcript's filename is known before the process starts.
    const claudeSessionId = previous?.claudeSessionId ?? randomUUID();

    await this.spawnPty(sessionId, cwd, {
      mode: previous ? 'resume' : 'start',
      claudeSessionId,
    });

    const session: SessionSnapshot = {
      sessionId,
      claudeSessionId,
      anchor,
      cwd,
      label: finalLabel,
      status: 'running',
      // A reopened entity-anchor session (spawn again after exit) is the same
      // logical session as `previous` — same reasoning as `finalLabel`/
      // `claudeSessionId` above, so its browser toggle carries forward too.
      browserEnabled: previous?.browserEnabled ?? false,
    };
    this.sessions.set(sessionId, session);
    return this.withOutput(session);
  }

  private async spawnPty(sessionId: string, cwd: string, conversation: ClaudeConversationTarget): Promise<void> {
    const mcpConfigPath = this.browserMcpConfigPaths.get(sessionId);
    try {
      await this.claudeSession.spawn(sessionId, cwd, {
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        conversation,
        ...(mcpConfigPath ? { mcpConfigPath } : {}),
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
   * `sessionId`: it just purges whatever is there (or no-ops). Unlike `kill`,
   * this is a real teardown — it also tears down the embedded browser (if
   * one was ever enabled for this session), the one other place besides
   * `disable` that does.
   */
  async remove(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.status === 'running') this.claudeSession.kill(sessionId);
    if (this.browserMcpConfigPaths.has(sessionId)) {
      // A failure here shouldn't strand the session forgotten-by-half —
      // forgetting it is the point of `remove`, resource leak or not.
      await this.embeddedBrowser.destroy(sessionId).catch(() => {});
      this.browserMcpConfigPaths.delete(sessionId);
    }
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
  }

  /**
   * Turns the embedded browser tool on/off for a session that has already
   * been spawned at least once. Enabling materializes the `WebContentsView`
   * + its ephemeral `--mcp-config` file up front; disabling tears both down
   * immediately (unlike `kill`, which deliberately leaves them alone so a
   * `resume` doesn't need to regenerate anything). The CLI only reads
   * `--mcp-config` at its own startup, so toggling this on an already-running
   * session has no live effect until it's next restarted.
   */
  async setBrowserEnabled(sessionId: string, enabled: boolean): Promise<SessionSnapshot> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError('not_found', `Unknown session '${sessionId}'`, { sessionId });
    }
    if (session.browserEnabled === enabled) return session;

    if (enabled) {
      const { mcpConfigPath } = await this.embeddedBrowser.create(sessionId);
      this.browserMcpConfigPaths.set(sessionId, mcpConfigPath);
    } else {
      await this.embeddedBrowser.destroy(sessionId);
      this.browserMcpConfigPaths.delete(sessionId);
    }
    session.browserEnabled = enabled;
    return session;
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
