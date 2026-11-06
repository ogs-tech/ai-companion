export interface QuitCoordinatorDeps {
  /** Pushes the request to the renderer. Returns false when there is no live renderer to ask. */
  send(requestId: string): boolean;
  newId(): string;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  timeoutMs?: number;
}

export const QUIT_REQUEST_TIMEOUT_MS = 3000;

/**
 * Asks the renderer whether it is fine to close. Resolves `true` (proceed) when the renderer says so,
 * when it cannot be asked, or when it does not answer in time: the app must never become impossible to close.
 * `false` only on an explicit "cancel" from the renderer. Concurrent requests share one question.
 */
export class QuitCoordinator {
  private pending: { id: string; timer: unknown; resolve: (proceed: boolean) => void; promise: Promise<boolean> } | null = null;

  constructor(private readonly deps: QuitCoordinatorDeps) {}

  request(): Promise<boolean> {
    if (this.pending !== null) return this.pending.promise;
    const id = this.deps.newId();
    let resolve!: (proceed: boolean) => void;
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    let delivered = false;
    try {
      delivered = this.deps.send(id);
    } catch {
      delivered = false;
    }
    if (!delivered) return Promise.resolve(true);
    const timer = this.deps.setTimer(() => this.settle(id, true), this.deps.timeoutMs ?? QUIT_REQUEST_TIMEOUT_MS);
    this.pending = { id, timer, resolve, promise };
    return promise;
  }

  /** Called by IPC `desktop.respondToQuit`. An unknown or stale `requestId` is ignored. */
  respond(requestId: string, proceed: boolean): void {
    this.settle(requestId, proceed);
  }

  private settle(id: string, proceed: boolean): void {
    if (this.pending === null || this.pending.id !== id) return;
    const { timer, resolve } = this.pending;
    this.pending = null;
    this.deps.clearTimer(timer);
    resolve(proceed);
  }
}
