import { spawn as ptySpawn, type IPty } from 'node-pty';
import type {
  ClaudeSessionDataListener,
  ClaudeSessionExitListener,
  ClaudeSessionPort,
  ClaudeSessionSpawnOptions,
} from '../../application/ports/claude-session-port.js';

/** Names a conversation the CLI must create, writing its transcript to `<uuid>.jsonl`. */
const startArgs = (claudeSessionId: string): string[] => ['--session-id', claudeSessionId];
/** Reattaches to a conversation that already exists, by the same id. */
const resumeArgs = (claudeSessionId: string): string[] => ['--resume', claudeSessionId];
/**
 * `claude` refuses rather than falling back when it's asked for a
 * conversation it can't find: `--resume <id>` prints
 * "No conversation found with session ID: <id>" and exits 1 (the retired
 * `--continue` printed "No conversation found to continue"). Matching on the
 * shared prefix lets `spawnWithArgs` retry once as a fresh `--session-id`
 * under the *same* id, so a session whose transcript was never written — it
 * exited before the first response — still reopens, and its id still lines
 * up with the transcript it is about to create.
 */
const NO_CONVERSATION_MARKER = 'No conversation found';
/** Only needed to catch NO_CONVERSATION_MARKER at exit — capped so a long-running session's onData doesn't accumulate its entire output in memory for the rest of its life. */
const DETECTION_WINDOW_CHARS = 4096;

/**
 * Spawns the user's locally installed `claude` CLI inside a real PTY via
 * `node-pty` so its interactive TUI renders correctly (cursor movement,
 * spinners, raw keyboard input all depend on `process.stdout.isTTY`).
 * The conversation is always named explicitly by `opts.conversation`, never
 * inferred from the cwd: `start` passes `--session-id <uuid>` so the CLI
 * creates that exact conversation, `resume` passes `--resume <uuid>` to
 * reattach to it. Naming it up front is what makes a live session and its
 * on-disk transcript (`<uuid>.jsonl`) the same thing rather than a guess,
 * and it is why two sessions sharing a cwd can no longer capture each
 * other's conversation the way `--continue` allowed.
 */
export class NodePtySessionAdapter implements ClaudeSessionPort {
  private readonly ptys = new Map<string, IPty>();
  private dataListener: ClaudeSessionDataListener | null = null;
  private exitListener: ClaudeSessionExitListener | null = null;

  // `bin` is overridable so tests can point at a stub script and exercise the
  // real ENOENT/exit-code branches without depending on `claude` being installed.
  constructor(private readonly bin = 'claude') {}

  onData(listener: ClaudeSessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: ClaudeSessionExitListener): void {
    this.exitListener = listener;
  }

  /**
   * Known limitation: On platforms where node-pty reports spawn failures
   * asynchronously (via immediate exit), the heuristic below detects "no data
   * before exit" and classifies it as a spawn failure (rejected promise).
   * This works reliably for actual missing binaries (which almost always print
   * an error first), but could rarely misclassify a legitimate silent exit as
   * a spawn failure. Callers should not assume spawn rejection is *only* caused
   * by a missing binary — it could be a fast, silent exit from the process itself.
   */
  spawn(sessionId: string, cwd: string, opts: ClaudeSessionSpawnOptions): Promise<void> {
    const { mode, claudeSessionId } = opts.conversation;
    if (mode === 'start') return this.spawnWithArgs(sessionId, cwd, opts, startArgs(claudeSessionId), null);
    // A resume that finds nothing to resume falls back to creating that same
    // conversation, rather than dead-ending as an immediately-'exited' session.
    return this.spawnWithArgs(sessionId, cwd, opts, resumeArgs(claudeSessionId), startArgs(claudeSessionId));
  }

  private spawnWithArgs(
    sessionId: string,
    cwd: string,
    opts: ClaudeSessionSpawnOptions,
    args: readonly string[],
    /** Args to retry once with when `args` reports no such conversation; `null` disables the retry. */
    missingConversationFallback: readonly string[] | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: IPty;
      try {
        child = ptySpawn(this.bin, args as string[], {
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
      let recentOutput = '';

      child.onData((chunk) => {
        hasData = true;
        recentOutput = (recentOutput + chunk).slice(-DETECTION_WINDOW_CHARS);
        if (!resolved) {
          resolved = true;
          resolve();
        }
        this.dataListener?.(sessionId, chunk);
      });

      child.onExit(({ exitCode }) => {
        this.ptys.delete(sessionId);

        if (!resolved && !hasData) {
          // Process exited immediately without producing output; treat as spawn failure
          resolved = true;
          reject(new Error(`Process exited with code ${exitCode}`));
          return;
        }

        if (missingConversationFallback && recentOutput.includes(NO_CONVERSATION_MARKER)) {
          // Retry transparently under the same sessionId — SessionService and
          // the renderer never see this exit, they just see a live session.
          this.spawnWithArgs(sessionId, cwd, opts, missingConversationFallback, null).catch(() => {
            // The retry's own promise is fire-and-forget from here (the
            // outer spawn() already resolved on the first attempt's data);
            // a retry failing this same way would be a real `claude` problem,
            // which still reaches the caller via a normal exit event above.
          });
          return;
        }

        // Normal exit after successful spawn
        this.exitListener?.(sessionId, exitCode);
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
