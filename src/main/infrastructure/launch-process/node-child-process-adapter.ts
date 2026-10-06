import { spawn as childSpawn, type ChildProcess } from 'node:child_process';
import type {
  LaunchProcessExitListener,
  LaunchProcessOutputListener,
  LaunchProcessPort,
  LaunchProcessSpawnOptions,
} from '../../application/ports/launch-process-port.js';

/** Spawns a plain (non-PTY) child process per launched config — see NodePtySessionAdapter for the analogous PTY-based adapter this mirrors, minus write/resize (nothing to write to; no PTY dimensions to report). */
export class NodeChildProcessAdapter implements LaunchProcessPort {
  private readonly children = new Map<string, ChildProcess>();
  private outputListener: LaunchProcessOutputListener | null = null;
  private exitListener: LaunchProcessExitListener | null = null;

  onOutput(listener: LaunchProcessOutputListener): void {
    this.outputListener = listener;
  }

  onExit(listener: LaunchProcessExitListener): void {
    this.exitListener = listener;
  }

  spawn(processId: string, opts: LaunchProcessSpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = childSpawn(opts.command, opts.args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      });
      this.children.set(processId, child);

      child.stdout?.on('data', (chunk: Buffer) => {
        this.outputListener?.(processId, 'stdout', chunk.toString('utf8'));
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.outputListener?.(processId, 'stderr', chunk.toString('utf8'));
      });

      child.once('spawn', () => {
        settled = true;
        resolve();
      });

      child.once('error', (err) => {
        this.children.delete(processId);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      child.once('exit', (exitCode, signal) => {
        this.children.delete(processId);
        if (!settled) {
          // Exited before 'spawn' ever fired — treat as a spawn failure.
          settled = true;
          reject(new Error(`Process exited with code ${exitCode} before spawning completed`));
          return;
        }
        this.exitListener?.(processId, exitCode, signal);
      });
    });
  }

  kill(processId: string, signal?: NodeJS.Signals): void {
    this.children.get(processId)?.kill(signal);
  }
}
