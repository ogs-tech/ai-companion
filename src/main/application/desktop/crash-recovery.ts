export const RELOAD_COOLDOWN_MS = 30_000;
export const UNRESPONSIVE_GRACE_MS = 10_000;

export type CrashChoice = 'reload' | 'quit';

export interface CrashRecoveryDeps {
  now(): number;
  log(message: string): void;
  reload(): void;
  /** Shown when a second failure happens inside the cooldown. */
  askUser(details: string): Promise<CrashChoice>;
  quit(): void;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Reloads the window after a renderer crash or hang, at most once per {@link RELOAD_COOLDOWN_MS}; a repeat
 * failure inside that window asks the user instead, so a crash on load cannot loop. Main-process state
 * (sessions) is untouched by a reload.
 */
export class CrashRecovery {
  private lastAutoReload: number | null = null;
  private pendingDetails: string | null = null;
  private unresponsiveTimer: unknown = null;
  private asking = false;

  constructor(private readonly deps: CrashRecoveryDeps) {}

  /** `render-process-gone`. */
  onGone(details: string): void {
    this.fail(`Renderer process gone: ${details}`);
  }

  /** `unresponsive`: waits a grace period so a busy-but-alive renderer is not reloaded. */
  onUnresponsive(): void {
    if (this.unresponsiveTimer !== null) return;
    this.deps.log('Renderer unresponsive (waiting before acting)');
    this.unresponsiveTimer = this.deps.setTimer(() => {
      this.unresponsiveTimer = null;
      this.fail(`Renderer unresponsive for more than ${UNRESPONSIVE_GRACE_MS / 1000} s`);
    }, UNRESPONSIVE_GRACE_MS);
  }

  /** `responsive`. */
  onResponsive(): void {
    if (this.unresponsiveTimer === null) return;
    this.deps.clearTimer(this.unresponsiveTimer);
    this.unresponsiveTimer = null;
  }

  /** `did-finish-load`: the details to hand to the renderer's recovery screen, once, or `null`. */
  takeRecovery(): string | null {
    const details = this.pendingDetails;
    this.pendingDetails = null;
    return details;
  }

  private fail(details: string): void {
    this.deps.log(details);
    const now = this.deps.now();
    if (this.lastAutoReload === null || now - this.lastAutoReload >= RELOAD_COOLDOWN_MS) {
      this.lastAutoReload = now;
      this.pendingDetails = details;
      this.deps.reload();
      return;
    }
    if (this.asking) return;
    this.asking = true;
    void this.deps.askUser(details).then((choice) => {
      this.asking = false;
      if (choice === 'quit') {
        this.deps.quit();
        return;
      }
      this.lastAutoReload = this.deps.now();
      this.pendingDetails = details;
      this.deps.reload();
    });
  }
}
