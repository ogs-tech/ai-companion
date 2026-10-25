import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  TerminalExitEvent,
  TerminalKind,
  TerminalOutputEvent,
  TerminalSnapshot,
  TerminalSnapshotWithOutput,
} from '../../../shared/terminal.js';
import type { Workspace } from '../../../shared/workspace.js';
import type { TerminalPort, TerminalSpawnOptions } from '../ports/terminal-port.js';
import type { LaunchConfigService } from './launch-config-service.js';
import { appendToScrollback, DEFAULT_MAX_SCROLLBACK_CHARS } from '../scrollback-buffer.js';
import { resolveLaunchCommand } from '../../domain/launch-config-command.js';
import { DomainError, ioError } from '../../domain/errors.js';

const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

export type TerminalOutputListener = (event: TerminalOutputEvent) => void;
export type TerminalExitListener = (event: TerminalExitEvent) => void;

interface TerminalEntry {
  snapshot: TerminalSnapshot;
  /** What a restart re-runs: same command, args, env and cwd. */
  spawn: Omit<TerminalSpawnOptions, 'cols' | 'rows'>;
  buffer: string[];
}

/**
 * Terminals are objects owned here, not by any view: closing a tab leaves the
 * process running and its scrollback buffered. Stopping is always explicit
 * (`kill`); only quitting the app or switching workspace ends them en masse.
 */
export class TerminalService {
  private readonly terminals = new Map<string, TerminalEntry>();
  private readonly outputListeners: TerminalOutputListener[] = [];
  private readonly exitListeners: TerminalExitListener[] = [];
  private readonly maxBufferChars: number;
  private readonly shell: string;

  constructor(
    /** `null` at Início — terminals need a working directory. */
    private readonly activeWorkspace: Pick<Workspace, 'id' | 'rootPath'> | null,
    private readonly launchConfigService: Pick<LaunchConfigService, 'getConfig'>,
    private readonly port: TerminalPort,
    options?: { maxBufferChars?: number; shell?: string },
  ) {
    this.maxBufferChars = options?.maxBufferChars ?? DEFAULT_MAX_SCROLLBACK_CHARS;
    this.shell = options?.shell ?? process.env['SHELL'] ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    this.port.onData((terminalId, chunk) => {
      const entry = this.terminals.get(terminalId);
      if (!entry) return;
      appendToScrollback(entry.buffer, chunk, this.maxBufferChars);
      for (const listener of this.outputListeners) listener({ terminalId, chunk });
    });
    this.port.onExit((terminalId, exitCode, signal) => {
      const entry = this.terminals.get(terminalId);
      if (entry) {
        entry.snapshot.status = 'exited';
        entry.snapshot.exitCode = exitCode;
      }
      for (const listener of this.exitListeners) listener({ terminalId, exitCode, signal });
    });
  }

  private requireWorkspace(): Pick<Workspace, 'id' | 'rootPath'> {
    if (this.activeWorkspace === null) throw new DomainError('validation', 'No workspace is open — terminals need one');
    return this.activeWorkspace;
  }

  /** Resolves `relCwd` under the workspace root, refusing anything that escapes it. */
  private resolveCwd(root: string, relCwd: string): { absolute: string; relative: string } {
    const absolute = path.resolve(root, relCwd);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new DomainError('validation', `Terminal folder '${relCwd}' is outside the workspace`);
    }
    return { absolute, relative: relative.split(path.sep).join('/') };
  }

  private async start(
    workspaceId: string,
    kind: TerminalKind,
    name: string,
    relCwd: string,
    spawn: TerminalEntry['spawn'],
  ): Promise<TerminalSnapshot> {
    const terminalId = randomUUID();
    const snapshot: TerminalSnapshot = {
      terminalId, workspaceId, kind, name, relCwd, status: 'running', exitCode: null, generation: 0,
    };
    const entry: TerminalEntry = { snapshot, spawn, buffer: [] };
    this.terminals.set(terminalId, entry);
    try {
      await this.port.spawn(terminalId, { ...spawn, cols: INITIAL_COLS, rows: INITIAL_ROWS });
    } catch (err) {
      this.terminals.delete(terminalId);
      throw ioError({
        message: `Failed to start terminal '${name}': ${(err as Error).message}`,
        details: { reason: 'terminal_spawn_failed' },
      });
    }
    return { ...snapshot };
  }

  /** An interactive login shell in `relCwd` (workspace-relative; the root when omitted). */
  async createShell(relCwd = ''): Promise<TerminalSnapshot> {
    const workspace = this.requireWorkspace();
    const { absolute, relative } = this.resolveCwd(workspace.rootPath, relCwd);
    const args = process.platform === 'win32' ? [] : ['-l'];
    return this.start(workspace.id, 'shell', path.basename(this.shell), relative, {
      command: this.shell, args, cwd: absolute,
    });
  }

  /** A terminal running a `launch.json` configuration's resolved command directly (no shell, so exit codes stay accurate). Two runs of one configuration are two terminals. */
  async runLaunch(configName: string): Promise<TerminalSnapshot> {
    const { config, workspaceId, rootPath } = await this.launchConfigService.getConfig(configName);
    const resolved = resolveLaunchCommand(config, rootPath);
    const relative = path.relative(rootPath, resolved.cwd).split(path.sep).join('/');
    return this.start(workspaceId, 'launch', configName, relative, {
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      ...(resolved.env !== undefined ? { env: resolved.env } : {}),
    });
  }

  write(terminalId: string, data: string): void {
    this.port.write(terminalId, data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.port.resize(terminalId, cols, rows);
  }

  /** Sends the stop request; the row flips to exited when the process actually does (see `onExit`). */
  kill(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (entry?.snapshot.status === 'running') this.port.kill(terminalId);
  }

  /** Re-runs an exited terminal's command in a new PTY, keeping its id, name and position. */
  async restart(terminalId: string): Promise<TerminalSnapshot> {
    const entry = this.requireEntry(terminalId);
    if (entry.snapshot.status !== 'exited') throw new DomainError('validation', `Terminal '${terminalId}' is still running`);
    entry.buffer = [];
    entry.snapshot.status = 'running';
    entry.snapshot.exitCode = null;
    entry.snapshot.generation += 1;
    try {
      await this.port.spawn(terminalId, { ...entry.spawn, cols: INITIAL_COLS, rows: INITIAL_ROWS });
    } catch (err) {
      entry.snapshot.status = 'exited';
      throw ioError({
        message: `Failed to restart terminal '${entry.snapshot.name}': ${(err as Error).message}`,
        details: { reason: 'terminal_spawn_failed' },
      });
    }
    return { ...entry.snapshot };
  }

  /** Drops an exited terminal's row. A running one must be stopped first. */
  remove(terminalId: string): void {
    const entry = this.requireEntry(terminalId);
    if (entry.snapshot.status === 'running') throw new DomainError('validation', `Terminal '${terminalId}' is still running`);
    this.terminals.delete(terminalId);
  }

  private requireEntry(terminalId: string): TerminalEntry {
    const entry = this.terminals.get(terminalId);
    if (!entry) throw new DomainError('not_found', `Terminal '${terminalId}' not found`);
    return entry;
  }

  status(terminalId: string): TerminalSnapshotWithOutput | undefined {
    this.requireWorkspace();
    const entry = this.terminals.get(terminalId);
    return entry ? { ...entry.snapshot, outputBuffer: entry.buffer.join('') } : undefined;
  }

  list(): TerminalSnapshot[] {
    this.requireWorkspace();
    return Array.from(this.terminals.values(), (e) => ({ ...e.snapshot }));
  }

  killAll(): void {
    for (const [terminalId, entry] of this.terminals) {
      if (entry.snapshot.status === 'running') this.port.kill(terminalId);
    }
  }

  onOutput(listener: TerminalOutputListener): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: TerminalExitListener): void {
    this.exitListeners.push(listener);
  }
}
