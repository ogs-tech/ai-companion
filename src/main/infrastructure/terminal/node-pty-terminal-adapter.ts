import { constants } from 'node:os';
import { spawn as ptySpawn, type IPty } from 'node-pty';
import type {
  TerminalDataListener,
  TerminalExitListener,
  TerminalPort,
  TerminalSpawnOptions,
} from '../../application/ports/terminal-port.js';

/** How long a silent process may live before it counts as started. */
const SPAWN_GRACE_MS = 150;

function signalName(signal: number | undefined): string | null {
  if (!signal) return null;
  const entry = Object.entries(constants.signals).find(([, value]) => value === signal);
  return entry ? entry[0] : String(signal);
}

/** Runs each terminal in a real PTY via `node-pty`, so input, Ctrl+C and interactive prompts work. */
export class NodePtyTerminalAdapter implements TerminalPort {
  private readonly ptys = new Map<string, IPty>();
  private dataListener: TerminalDataListener | null = null;
  private exitListener: TerminalExitListener | null = null;

  onData(listener: TerminalDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: TerminalExitListener): void {
    this.exitListener = listener;
  }

  spawn(terminalId: string, opts: TerminalSpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: IPty;
      try {
        child = ptySpawn(opts.command, opts.args, {
          name: 'xterm-256color',
          cols: opts.cols,
          rows: opts.rows,
          cwd: opts.cwd,
          env: { ...process.env, ...opts.env, TERM: 'xterm-256color' } as Record<string, string>,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ptys.set(terminalId, child);

      // node-pty can report a missing binary or cwd asynchronously, as an
      // immediate exit with no output (see NodePtySessionAdapter). Output, or
      // surviving the grace period, proves the process really started; a
      // silent exit before either is a spawn failure.
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(settle, SPAWN_GRACE_MS);

      // Both callbacks check identity: after a restart reuses the id, the old PTY's late events must not leak into the new run.
      child.onData((chunk) => {
        settle();
        if (this.ptys.get(terminalId) === child) this.dataListener?.(terminalId, chunk);
      });
      child.onExit(({ exitCode, signal }) => {
        if (this.ptys.get(terminalId) !== child) return;
        this.ptys.delete(terminalId);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Process exited with code ${exitCode} before producing output`));
          return;
        }
        this.exitListener?.(terminalId, exitCode, signalName(signal));
      });
    });
  }

  write(terminalId: string, data: string): void {
    this.ptys.get(terminalId)?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    try {
      this.ptys.get(terminalId)?.resize(cols, rows);
    } catch {
      // node-pty throws when the PTY has already exited; a late resize is harmless.
    }
  }

  kill(terminalId: string): void {
    this.ptys.get(terminalId)?.kill();
  }
}
