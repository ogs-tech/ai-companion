import { spawn as ptySpawn, type IPty } from 'node-pty';
import type {
  ClaudeSessionDataListener,
  ClaudeSessionExitListener,
  ClaudeSessionPort,
  ClaudeSessionSpawnOptions,
} from '../../application/ports/claude-session-port.js';

const CLAUDE_ARGS = ['--continue'];

/**
 * Spawns the user's locally installed `claude` CLI inside a real PTY via
 * `node-pty` so its interactive TUI renders correctly (cursor movement,
 * spinners, raw keyboard input all depend on `process.stdout.isTTY`).
 * Always passes `--continue`: `claude` falls back to starting a fresh
 * conversation when no prior transcript exists for the cwd, so this covers
 * both "first ever open" and "resume" without the adapter needing to detect
 * which case it is.
 */
export class NodePtySessionAdapter implements ClaudeSessionPort {
  private readonly ptys = new Map<string, IPty>();
  private dataListener: ClaudeSessionDataListener | null = null;
  private exitListener: ClaudeSessionExitListener | null = null;

  // `bin` is overridable so tests can point at a stub script and exercise the
  // real ENOENT/exit-code branches without depending on `claude` being
  // installed — mirrors NodeClaudeCliAdapter's testability pattern.
  constructor(private readonly bin = 'claude') {}

  onData(listener: ClaudeSessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: ClaudeSessionExitListener): void {
    this.exitListener = listener;
  }

  spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: IPty;
      try {
        child = ptySpawn(this.bin, CLAUDE_ARGS, {
          name: 'xterm-color',
          cols: opts.cols,
          rows: opts.rows,
          cwd,
          env: process.env as Record<string, string>,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.ptys.set(sessionId, child);

      // Track whether the spawn promise has been resolved/rejected yet.
      // On some platforms (e.g., macOS), node-pty may not throw synchronously
      // for a missing binary. Instead, it reports the failure asynchronously via
      // an immediate exit with no output. Listen for this case and reject if we
      // see an exit before any data arrives.
      let resolved = false;
      let hasData = false;

      child.onData((chunk) => {
        hasData = true;
        if (!resolved) {
          resolved = true;
          resolve();
        }
        this.dataListener?.(sessionId, chunk);
      });

      child.onExit(({ exitCode }) => {
        if (!resolved && !hasData) {
          // Process exited immediately without producing output; treat as spawn failure
          resolved = true;
          this.ptys.delete(sessionId);
          reject(new Error(`Process exited with code ${exitCode}`));
        } else {
          // Normal exit after successful spawn
          this.ptys.delete(sessionId);
          this.exitListener?.(sessionId, exitCode);
        }
      });

      // If the process produces data, resolve immediately. Otherwise, wait for either
      // data to arrive or the process to exit. Use a small timeout to handle cases
      // where the process starts successfully but doesn't immediately produce output.
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 100);
    });
  }

  write(sessionId: string, data: string): void {
    this.ptys.get(sessionId)?.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.ptys.get(sessionId)?.resize(cols, rows);
  }

  kill(sessionId: string): void {
    this.ptys.get(sessionId)?.kill();
    this.ptys.delete(sessionId);
  }
}
