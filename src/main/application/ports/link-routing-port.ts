export type LinkListener = (url: string) => void;

/**
 * Catches URLs a session's CLI opens through the OS opener (`open <url>`),
 * which never touches the terminal and so can't be intercepted in xterm.
 * Concrete impl listens on a local channel and hands the PTY the env that
 * points the opener at it.
 */
export interface LinkRoutingPort {
  /** Starts listening. Rejects when the channel can't be created; `shimEnv()` is empty until it succeeds. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Called with every accepted `http(s)` URL. */
  onUrl(listener: LinkListener): void;
  /** Env vars to merge into a session PTY's env so its opener reaches this router. */
  shimEnv(): Record<string, string>;
}
