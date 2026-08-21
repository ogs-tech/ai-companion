import type { Entity, Instruction } from '../../../shared/entity.js';
import { isProjectInstruction } from '../../../shared/entity.js';
import type { SessionSnapshot, SessionStatus } from '../../../shared/session.js';
import type { EntityService } from './entity-service.js';
import type { ClaudeSessionPort } from '../ports/claude-session-port.js';
import { ioError } from '../../domain/errors.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export type SessionOutputListener = (sessionId: string, chunk: string) => void;
export type SessionStatusListener = (sessionId: string, status: SessionStatus, exitCode: number) => void;

/**
 * Owns the one-live-session-per-entity invariant. `sessionId` is always the
 * entity's own urn — since only one session can be live per entity, there's
 * no need for a separate generated id.
 */
export class SessionService {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly outputListeners: SessionOutputListener[] = [];
  private readonly exitListeners: SessionStatusListener[] = [];

  constructor(
    private readonly entityService: EntityService,
    private readonly claudeSession: ClaudeSessionPort,
    private readonly workspacePath: string,
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

  async spawn(entityUrn: string): Promise<SessionSnapshot> {
    const existing = this.sessions.get(entityUrn);
    if (existing && existing.status === 'running') return existing;

    const entity = await this.entityService.get(entityUrn);
    const cwd = this.resolveCwd(entity);

    try {
      await this.claudeSession.spawn(entityUrn, cwd, { cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    } catch (err) {
      throw ioError({
        message: `Failed to start a claude session: ${(err as Error).message}`,
        details: { reason: 'claude_session_spawn_failed' },
      });
    }

    const session: SessionSnapshot = { entityUrn, cwd, status: 'running' };
    this.sessions.set(entityUrn, session);
    return session;
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

  private resolveCwd(entity: Entity): string {
    if (entity.kind === 'instruction') {
      const instruction = entity as Instruction;
      if (isProjectInstruction(instruction)) return instruction.repoPath;
    }
    return this.workspacePath;
  }
}
