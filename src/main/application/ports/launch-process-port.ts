export interface LaunchProcessSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export type LaunchProcessOutputListener = (processId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type LaunchProcessExitListener = (processId: string, exitCode: number | null, signal: NodeJS.Signals | null) => void;

/**
 * Spawns a plain child process per `processId` — no PTY, no interactive
 * input, distinct stdout/stderr streams. `onOutput`/`onExit` each store a
 * single listener (mirroring `ClaudeSessionPort`'s real shape, one callback
 * per port instance) — the array-based multi-listener fan-out lives one
 * layer up, in `LaunchProcessService`, exactly like `SessionService` does
 * over `ClaudeSessionPort`.
 */
export interface LaunchProcessPort {
  spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void>;
  kill(processId: string, signal?: NodeJS.Signals): void;
  onOutput(listener: LaunchProcessOutputListener): void;
  onExit(listener: LaunchProcessExitListener): void;
}
