import type {
  LaunchProcessExitListener,
  LaunchProcessOutputListener,
  LaunchProcessPort,
  LaunchProcessSpawnOptions,
} from '../../ports/launch-process-port.js';

export class FakeLaunchProcessPort implements LaunchProcessPort {
  spawnCalls: Array<{ processId: string; opts: LaunchProcessSpawnOptions }> = [];
  killed: Array<{ processId: string; signal?: NodeJS.Signals }> = [];

  private nextSpawnFailure: Error | null = null;
  private outputListener: LaunchProcessOutputListener | null = null;
  private exitListener: LaunchProcessExitListener | null = null;

  onOutput(listener: LaunchProcessOutputListener): void {
    this.outputListener = listener;
  }

  onExit(listener: LaunchProcessExitListener): void {
    this.exitListener = listener;
  }

  failNextSpawn(error: Error): void {
    this.nextSpawnFailure = error;
  }

  async spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void> {
    if (this.nextSpawnFailure) {
      const err = this.nextSpawnFailure;
      this.nextSpawnFailure = null;
      throw err;
    }
    this.spawnCalls.push({ processId, opts });
  }

  kill(processId: string, signal?: NodeJS.Signals): void {
    this.killed.push(signal !== undefined ? { processId, signal } : { processId });
  }

  simulateOutput(processId: string, stream: 'stdout' | 'stderr', chunk: string): void {
    this.outputListener?.(processId, stream, chunk);
  }

  simulateExit(processId: string, exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitListener?.(processId, exitCode, signal);
  }
}
