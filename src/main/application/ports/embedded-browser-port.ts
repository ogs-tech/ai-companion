export interface EmbeddedBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedBrowserStatus {
  url: string;
}

/**
 * Owns the per-session embedded browser: a real, navigable view (manual
 * navigation) plus the CDP endpoint a spawned `@playwright/mcp` process can
 * drive (agent automation) — both acting on the same page. `sessionId` is
 * caller-assigned (`SessionService`'s own key), mirroring `ClaudeSessionPort`.
 */
export interface EmbeddedBrowserPort {
  /**
   * Creates the view and writes its ephemeral `--mcp-config` file, returning
   * the path to hand the CLI at spawn. Idempotent while already created for
   * that `sessionId` — returns the same path without creating a second view.
   */
  create(sessionId: string): Promise<{ mcpConfigPath: string }>;
  /** Tears the view down, detaches its debugger session, deletes the ephemeral config file. No-op if never created for that `sessionId`. */
  destroy(sessionId: string): Promise<void>;
  /** Tears down every session's view — used at app quit and workspace switch, where sessions are killed in bulk without going through `destroy` per session. */
  destroyAll(): Promise<void>;
  navigate(sessionId: string, url: string): Promise<void>;
  /** Positions the view within the app window. No-op if never created for that `sessionId`. */
  setBounds(sessionId: string, bounds: EmbeddedBrowserBounds): void;
  status(sessionId: string): EmbeddedBrowserStatus | null;
}
