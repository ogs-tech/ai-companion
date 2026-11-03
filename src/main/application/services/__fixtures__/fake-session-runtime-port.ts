import { randomUUID } from 'node:crypto';
import type {
  SessionDataListener,
  SessionExitListener,
  SessionRuntimePort,
  SessionSpawnOptions,
} from '../../ports/session-runtime-port.js';

export class FakeSessionRuntimePort implements SessionRuntimePort {
  spawnCalls: Array<{ sessionId: string; cwd: string; opts: SessionSpawnOptions }> = [];
  writes: Array<[string, string]> = [];
  resizes: Array<[string, number, number]> = [];
  killed: string[] = [];

  available = true;
  private nextSpawnFailure: Error | null = null;
  private dataListener: SessionDataListener | null = null;
  private exitListener: SessionExitListener | null = null;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async newConversationId(): Promise<string> {
    return randomUUID();
  }

  onData(listener: SessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: SessionExitListener): void {
    this.exitListener = listener;
  }

  failNextSpawn(error: Error): void {
    this.nextSpawnFailure = error;
  }

  async spawn(sessionId: string, cwd: string, opts: SessionSpawnOptions): Promise<void> {
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
