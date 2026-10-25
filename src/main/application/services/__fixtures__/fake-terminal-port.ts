import type {
  TerminalDataListener,
  TerminalExitListener,
  TerminalPort,
  TerminalSpawnOptions,
} from '../../ports/terminal-port.js';

export class FakeTerminalPort implements TerminalPort {
  spawnCalls: Array<{ terminalId: string; opts: TerminalSpawnOptions }> = [];
  writes: Array<{ terminalId: string; data: string }> = [];
  resizes: Array<{ terminalId: string; cols: number; rows: number }> = [];
  killed: string[] = [];

  private nextSpawnFailure: Error | null = null;
  private dataListener: TerminalDataListener | null = null;
  private exitListener: TerminalExitListener | null = null;

  onData(listener: TerminalDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: TerminalExitListener): void {
    this.exitListener = listener;
  }

  failNextSpawn(error: Error): void {
    this.nextSpawnFailure = error;
  }

  async spawn(terminalId: string, opts: TerminalSpawnOptions): Promise<void> {
    if (this.nextSpawnFailure) {
      const err = this.nextSpawnFailure;
      this.nextSpawnFailure = null;
      throw err;
    }
    this.spawnCalls.push({ terminalId, opts });
  }

  write(terminalId: string, data: string): void {
    this.writes.push({ terminalId, data });
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.resizes.push({ terminalId, cols, rows });
  }

  kill(terminalId: string): void {
    this.killed.push(terminalId);
  }

  simulateOutput(terminalId: string, chunk: string): void {
    this.dataListener?.(terminalId, chunk);
  }

  simulateExit(terminalId: string, exitCode: number | null, signal: string | null = null): void {
    this.exitListener?.(terminalId, exitCode, signal);
  }
}
