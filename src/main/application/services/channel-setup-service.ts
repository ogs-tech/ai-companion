import { randomUUID } from 'node:crypto';
import { CHANNELS, type ChannelId } from '../../../shared/channel.js';
import type { ChannelSetupAction, ChannelSetupStart, ChannelSetupTerminal, ChannelStatus } from '../../../shared/channel-setup.js';
import type { TerminalExitEvent, TerminalOutputEvent } from '../../../shared/terminal.js';
import { DomainError, ioError } from '../../domain/errors.js';
import type { ChannelProbePort } from '../ports/channel-probe-port.js';
import type { TerminalPort } from '../ports/terminal-port.js';
import { appendToScrollback, DEFAULT_MAX_SCROLLBACK_CHARS } from '../scrollback-buffer.js';

interface SetupTerminal {
  status: 'running' | 'exited';
  exitCode: number | null;
  buffer: string[];
}

/**
 * Tells where a channel stands (installed? signed in?) and runs its install / sign-in command in a visible PTY.
 * Global: it needs neither a workspace nor a session, so Config works at Início. Commands come only from the
 * registry (`ChannelDescriptor.setup`) — the renderer sends a channel id and an action, never a command line.
 */
export class ChannelSetupService {
  private readonly terminals = new Map<string, SetupTerminal>();
  private readonly outputListeners: Array<(event: TerminalOutputEvent) => void> = [];
  private readonly exitListeners: Array<(event: TerminalExitEvent) => void> = [];

  constructor(
    private readonly probe: ChannelProbePort,
    private readonly port: TerminalPort,
    private readonly deps: {
      shell: string;
      cwd: string;
      env: () => Record<string, string>;
      openExternal: (url: string) => Promise<void>;
    },
  ) {
    port.onData((terminalId, chunk) => {
      const entry = this.terminals.get(terminalId);
      if (!entry) return;
      appendToScrollback(entry.buffer, chunk, DEFAULT_MAX_SCROLLBACK_CHARS);
      for (const l of this.outputListeners) l({ terminalId, chunk });
    });
    port.onExit((terminalId, exitCode, signal) => {
      const entry = this.terminals.get(terminalId);
      if (!entry) return;
      entry.status = 'exited';
      entry.exitCode = exitCode;
      for (const l of this.exitListeners) l({ terminalId, exitCode, signal });
    });
  }

  onOutput(listener: (event: TerminalOutputEvent) => void): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: (event: TerminalExitEvent) => void): void {
    this.exitListeners.push(listener);
  }

  async status(channelId: ChannelId): Promise<ChannelStatus> {
    const { setup } = CHANNELS[channelId];
    const version = await this.probe.run(setup.bin, setup.versionArgs);
    if (!version.found || version.exitCode !== 0) return { channelId, installed: false, signedIn: setup.auth === null ? null : false };
    const firstLine = version.output.trim().split('\n')[0] ?? '';
    const base = { channelId, installed: true, ...(firstLine !== '' ? { version: firstLine } : {}) };
    if (setup.auth === null) return { ...base, signedIn: null };
    const auth = await this.probe.run(setup.bin, setup.auth.statusArgs);
    return { ...base, signedIn: auth.found && auth.exitCode === 0 && auth.output.includes(setup.auth.signedInMarker) };
  }

  async start(channelId: ChannelId, action: ChannelSetupAction): Promise<ChannelSetupStart> {
    const { setup, displayName } = CHANNELS[channelId];
    if (action === 'install' && setup.install.kind === 'download') {
      await this.deps.openExternal(setup.install.url);
      return { kind: 'opened', url: setup.install.url };
    }
    const command = action === 'install' ? (setup.install.kind === 'command' ? setup.install.command : null) : (setup.auth?.loginCommand ?? null);
    if (command === null) throw new DomainError('validation', `${displayName} has no '${action}' step`, { reason: 'no_setup_step', channelId, action });

    const terminalId = randomUUID();
    this.terminals.set(terminalId, { status: 'running', exitCode: null, buffer: [] });
    try {
      // `-l` so the user's PATH (node, brew) is there; `-c` so the shell exits with the command's own code.
      await this.port.spawn(terminalId, { command: this.deps.shell, args: ['-lc', command], cwd: this.deps.cwd, env: this.deps.env(), cols: 80, rows: 24 });
    } catch (err) {
      this.terminals.delete(terminalId);
      throw ioError({ message: `Failed to start ${displayName} ${action}: ${(err as Error).message}`, details: { reason: 'channel_setup_spawn_failed' } });
    }
    return { kind: 'terminal', terminalId, title: `${action === 'install' ? 'Instalar' : 'Entrar no'} ${displayName}` };
  }

  terminal(terminalId: string): ChannelSetupTerminal | null {
    const entry = this.terminals.get(terminalId);
    return entry ? { terminalId, status: entry.status, exitCode: entry.exitCode, outputBuffer: entry.buffer.join('') } : null;
  }

  write(terminalId: string, data: string): void {
    if (this.terminals.get(terminalId)?.status === 'running') this.port.write(terminalId, data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    if (this.terminals.get(terminalId)?.status === 'running') this.port.resize(terminalId, cols, rows);
  }

  /** Stops the process (if running) and forgets the terminal. */
  close(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) return;
    if (entry.status === 'running') this.port.kill(terminalId);
    this.terminals.delete(terminalId);
  }

  killAll(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }
}
