import { spawn as ptySpawn, type IPty } from 'node-pty';
import type {
  SessionDataListener,
  SessionExitListener,
  SessionRuntimePort,
  SessionSpawnOptions,
} from '../../application/ports/session-runtime-port.js';
import { SIGNAL_FILE_ENV } from '../../application/session-activity.js';
import { CLAUDE_PROFILE, type CliProfile } from './cli-profiles.js';
import { isExecutableAvailable } from './find-executable.js';

/** Only needed to catch the profile's missing-conversation marker at exit — capped so a long-running session's onData doesn't accumulate its entire output in memory for the rest of its life. */
const DETECTION_WINDOW_CHARS = 4096;

/**
 * Spawns a harness's locally installed CLI inside a real PTY via
 * `node-pty` so its interactive TUI renders correctly (cursor movement,
 * spinners, raw keyboard input all depend on `process.stdout.isTTY`).
 * The conversation is always named explicitly by `opts.conversation`, never
 * inferred from the cwd; the flags that do so come from the {@link CliProfile}
 * (Claude: `--session-id` / `--resume`; Cursor: `--resume` of a chat made by
 * `create-chat`). Naming it up front is what makes a live session and its
 * on-disk transcript the same thing rather than a guess, and it is why two
 * sessions sharing a cwd can no longer capture each other's conversation the
 * way `--continue` allowed.
 */
export class NodePtySessionAdapter implements SessionRuntimePort {
  private readonly ptys = new Map<string, IPty>();
  private dataListener: SessionDataListener | null = null;
  private exitListener: SessionExitListener | null = null;

  // `bin` is overridable so tests can point at a stub script and exercise the
  // real ENOENT/exit-code branches without depending on `claude` being installed.
  // `buildSessionEnv` supplies the PTY's env (inherited env + whatever the
  // composition root wants injected) so this class stays free of app paths.
  constructor(
    private readonly bin = 'claude',
    private readonly buildSessionEnv: () => NodeJS.ProcessEnv = () => process.env,
    private readonly profile: CliProfile = CLAUDE_PROFILE,
    /** Directories searched besides `PATH` when checking the CLI exists. */
    private readonly extraBinDirs: readonly string[] = [],
  ) {}

  isAvailable(): Promise<boolean> {
    return isExecutableAvailable(this.bin, this.extraBinDirs, this.buildSessionEnv()['PATH']);
  }

  newConversationId(cwd: string): Promise<string> {
    return this.profile.newConversationId({ bin: this.bin, cwd, env: this.buildSessionEnv() });
  }

  onData(listener: SessionDataListener): void {
    this.dataListener = listener;
  }

  onExit(listener: SessionExitListener): void {
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
  spawn(sessionId: string, cwd: string, opts: SessionSpawnOptions): Promise<void> {
    const { mode, conversationId } = opts.conversation;
    // Additive to whatever conversation args apply — appended once here so
    // both the primary attempt and the resume-fallback retry below carry it,
    // rather than each of `startArgs`/`resumeArgs` needing to know about it.
    const withExtras = (args: string[]): string[] => [
      ...args,
      ...(opts.mcpConfigPath && this.profile.supportsMcpConfig ? ['--mcp-config', opts.mcpConfigPath] : []),
      ...(this.profile.supportsAddDir ? (opts.addDirs ?? []).flatMap((dir) => ['--add-dir', dir]) : []),
      ...(opts.signalFile ? this.profile.signalArgs() : []),
    ];
    if (mode === 'start') {
      return this.spawnWithArgs(sessionId, cwd, opts, withExtras(this.profile.startArgs(conversationId)), null);
    }
    // A resume that finds nothing to resume falls back to creating that same
    // conversation, rather than dead-ending as an immediately-'exited' session.
    return this.spawnWithArgs(
      sessionId,
      cwd,
      opts,
      withExtras(this.profile.resumeArgs(conversationId)),
      this.profile.missingConversationMarker === null ? null : withExtras(this.profile.startArgs(conversationId)),
    );
  }

  private spawnWithArgs(
    sessionId: string,
    cwd: string,
    opts: SessionSpawnOptions,
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
          env: {
            ...(this.buildSessionEnv() as Record<string, string>),
            ...(opts.signalFile ? { [SIGNAL_FILE_ENV]: opts.signalFile } : {}),
          },
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

        const marker = this.profile.missingConversationMarker;
        if (missingConversationFallback && marker !== null && recentOutput.includes(marker)) {
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
