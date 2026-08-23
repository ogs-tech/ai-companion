import type { Instruction } from '../../../shared/entity.js';
import type { SessionAnchor, SessionSnapshot, SessionStatus } from '../../../shared/session.js';
import { sessionAnchorKey } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeSessionPort } from '../ports/claude-session-port.js';
import type { WorkspaceService } from './workspace-service.js';
import type { ProjectService } from './project-service.js';
import { resolveScopePath } from '../resolve-scope-path.js';
import { ioError } from '../../domain/errors.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export type SessionOutputListener = (sessionId: string, chunk: string) => void;
export type SessionStatusListener = (sessionId: string, status: SessionStatus, exitCode: number) => void;

/**
 * Owns the one-live-session-per-anchor invariant. `sessionId` is always
 * `sessionAnchorKey(anchor)` — since only one session can be live per
 * anchor, there's no need for a separate generated id.
 */
export class SessionService {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly pending = new Map<string, Promise<SessionSnapshot>>();
  private readonly outputListeners: SessionOutputListener[] = [];
  private readonly exitListeners: SessionStatusListener[] = [];

  constructor(
    private readonly entityService: EntityService,
    private readonly claudeSession: ClaudeSessionPort,
    private readonly workspacePath: string,
    private readonly scopeDeps: {
      workspaceService: Pick<WorkspaceService, 'get'>;
      projectService: Pick<ProjectService, 'get'>;
    },
  ) {
    this.claudeSession.onData((sessionId, chunk) => {
      for (const listener of this.outputListeners) listener(sessionId, chunk);
    });
    this.claudeSession.onExit((sessionId, exitCode) => {
      const session = this.sessions.get(sessionId);
      if (session) session.status = 'exited';
      for (const listener of this.exitListeners) listener(sessionId, 'exited', exitCode);
    });
  }

  async spawn(anchor: SessionAnchor): Promise<SessionSnapshot> {
    const sessionId = sessionAnchorKey(anchor);
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status === 'running') return existing;

    const pendingSpawn = this.pending.get(sessionId);
    if (pendingSpawn) return pendingSpawn;

    const spawnPromise = (async () => {
      const cwd = await this.resolveCwd(anchor);

      try {
        await this.claudeSession.spawn(sessionId, cwd, { cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      } catch (err) {
        throw ioError({
          message: `Failed to start a claude session: ${(err as Error).message}`,
          details: { reason: 'claude_session_spawn_failed' },
        });
      }

      const session: SessionSnapshot = { sessionId, anchor, cwd, status: 'running' };
      this.sessions.set(sessionId, session);
      return session;
    })().finally(() => {
      this.pending.delete(sessionId);
    });

    this.pending.set(sessionId, spawnPromise);
    return spawnPromise;
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

  status(sessionId: string): SessionSnapshot | undefined {
    return this.sessions.get(sessionId);
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

  private async resolveCwd(anchor: SessionAnchor): Promise<string> {
    if (anchor.kind === 'workspace') {
      return (await this.scopeDeps.workspaceService.get(anchor.workspaceId)).rootPath;
    }
    if (anchor.kind === 'project') {
      return (await this.scopeDeps.projectService.get(anchor.projectId)).path;
    }
    const entity = await this.entityService.get(anchor.urn);
    if (entity.kind === 'instruction') {
      const instruction = entity as Instruction;
      if (instruction.scopes[0] !== 'personal') {
        return resolveScopePath(instruction, this.scopeDeps);
      }
    }
    return this.workspacePath;
  }
}
