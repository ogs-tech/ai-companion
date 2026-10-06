import { randomUUID } from 'node:crypto';
import type {
  LaunchProcessExitEvent,
  LaunchProcessOutputEvent,
  LaunchProcessSnapshot,
  LaunchProcessSnapshotWithOutput,
} from '../../../shared/launch-config.js';
import type { LaunchProcessPort } from '../ports/launch-process-port.js';
import type { LaunchConfigService } from './launch-config-service.js';
import { resolveLaunchCommand } from '../../domain/launch-config-command.js';
import { ioError } from '../../domain/errors.js';

const DEFAULT_MAX_BUFFER_CHARS = 200_000;

export type LaunchProcessOutputListener = (event: LaunchProcessOutputEvent) => void;
export type LaunchProcessExitListener = (event: LaunchProcessExitEvent) => void;

/** Run lifecycle for launched configs — shaped like `SessionService` minus anchor resolution: every `run` mints a fresh `processId`, no dedup, no resume. */
export class LaunchProcessService {
  private readonly processes = new Map<string, LaunchProcessSnapshot>();
  private readonly outputBuffers = new Map<string, string[]>();
  private readonly outputListeners: LaunchProcessOutputListener[] = [];
  private readonly exitListeners: LaunchProcessExitListener[] = [];
  private readonly maxBufferChars: number;

  constructor(
    private readonly launchConfigService: Pick<LaunchConfigService, 'getConfig'>,
    private readonly port: LaunchProcessPort,
    options?: { maxBufferChars?: number },
  ) {
    this.maxBufferChars = options?.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    this.port.onOutput((processId, stream, chunk) => {
      this.appendToBuffer(processId, chunk);
      for (const listener of this.outputListeners) listener({ processId, stream, chunk });
    });
    this.port.onExit((processId, exitCode, signal) => {
      const process = this.processes.get(processId);
      if (process) {
        process.status = 'exited';
        process.exitCode = exitCode;
      }
      for (const listener of this.exitListeners) listener({ processId, exitCode, signal });
    });
  }

  private appendToBuffer(processId: string, chunk: string): void {
    const buf = this.outputBuffers.get(processId) ?? [];
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
    this.outputBuffers.set(processId, buf);
  }

  private withOutput(process: LaunchProcessSnapshot): LaunchProcessSnapshotWithOutput {
    return { ...process, outputBuffer: (this.outputBuffers.get(process.processId) ?? []).join('') };
  }

  async run(projectId: string, configName: string): Promise<LaunchProcessSnapshot> {
    const { config, projectPath } = await this.launchConfigService.getConfig(projectId, configName);
    const resolved = resolveLaunchCommand(config, projectPath);
    const processId = randomUUID();
    const snapshot: LaunchProcessSnapshot = { processId, projectId, configName, status: 'running', exitCode: null };
    this.processes.set(processId, snapshot);
    try {
      await this.port.spawn(processId, resolved);
    } catch (err) {
      this.processes.delete(processId);
      throw ioError({
        message: `Failed to start launch config '${configName}': ${(err as Error).message}`,
        details: { reason: 'launch_process_spawn_failed' },
      });
    }
    return snapshot;
  }

  kill(processId: string): void {
    const process = this.processes.get(processId);
    if (!process || process.status !== 'running') return;
    this.port.kill(processId);
    process.status = 'exited';
  }

  status(processId: string): LaunchProcessSnapshotWithOutput | undefined {
    const process = this.processes.get(processId);
    return process ? this.withOutput(process) : undefined;
  }

  list(): LaunchProcessSnapshot[] {
    return Array.from(this.processes.values());
  }

  killAll(): void {
    for (const [processId, process] of this.processes) {
      if (process.status === 'running') {
        this.port.kill(processId);
        process.status = 'exited';
      }
    }
  }

  onOutput(listener: LaunchProcessOutputListener): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: LaunchProcessExitListener): void {
    this.exitListeners.push(listener);
  }
}
