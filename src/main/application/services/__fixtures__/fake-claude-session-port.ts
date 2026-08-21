import type {
  ClaudeSessionDataListener,
  ClaudeSessionExitListener,
  ClaudeSessionPort,
  ClaudeSessionSpawnOptions,
} from '../../ports/claude-session-port.js';

export class FakeClaudeSessionPort implements ClaudeSessionPort {
  spawnCalls: Array<{ sessionId: string; cwd: string; opts: ClaudeSessionSpawnOptions }> = [];
  writes: Array<[string, string]> = [];
  resizes: Array<[string, number, number]> = [];
  killed: string[] = [];

  private nextSpawnFailure: Error | null = null;
  private dataListener: ClaudeSessionDataListener | null = null;
  private exitListener: ClaudeSessionExitListener | null = null;

  onData(listener: ClaudeSessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: ClaudeSessionExitListener): void {
    this.exitListener = listener;
  }

  failNextSpawn(error: Error): void {
    this.nextSpawnFailure = error;
  }

  async spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void> {
    if (this.nextSpawnFailure) {
      const err = this.nextSpawnFailure;
      this.nextSpawnFailure = null;
      throw err;
    }
    this.spawnCalls.push({ sessionId, cwd, opts });
  }

  write(sessionId: string, data: string): void {
    this.writes.push([sessionId, data]);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.resizes.push([sessionId, cols, rows]);
  }

  kill(sessionId: string): void {
    this.killed.push(sessionId);
  }

  simulateData(sessionId: string, chunk: string): void {
    this.dataListener?.(sessionId, chunk);
  }

  simulateExit(sessionId: string, exitCode: number): void {
    this.exitListener?.(sessionId, exitCode);
  }
}
