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
 * Owns every embedded browser tab — one real, navigable `WebContentsView`
 * per tab. Each is positioned independently via `setBounds`; the renderer
 * side (a `BrowserPane` per Workbench tab, kept mounted but `display:none`
 * while its tab isn't the active one) reports zero bounds for itself while
 * hidden and its real bounds once shown, so at most one tab ever actually
 * renders — no separate "which tab is active" concept needed here. A tab
 * comes in one of two flavors, sharing the same `tabId` keyspace and the
 * same `navigate`/`setBounds`/`status` operations:
 *
 * - A **session tab** (`create`/`destroy`): `tabId` is the owning
 *   `SessionService` `sessionId` itself, and creation also writes the
 *   ephemeral `--mcp-config` a spawned `claude` CLI drives it through — the
 *   agent side of the feature. Lives for as long as that session's browser
 *   stays enabled, whether or not its tab is the one currently visible.
 * - A **manual tab** (`openTab`/`closeTab`): `tabId` is freshly minted, no
 *   session attached, no MCP config — just a page the user (or a redirected
 *   external link) is browsing by hand.
 */
export interface EmbeddedBrowserPort {
  /**
   * Creates a session tab and writes its ephemeral `--mcp-config` file,
   * returning the path to hand the CLI at spawn. Idempotent while already
   * created for that `sessionId` — returns the same path without creating a
   * second view.
   */
  create(sessionId: string): Promise<{ mcpConfigPath: string }>;
  /** Tears the session tab down, deletes its ephemeral config file. No-op if never created for that `sessionId`. */
  destroy(sessionId: string): Promise<void>;
  /** Opens a manual tab, navigating it to `url` (default `about:blank`) — no MCP config, not tied to any session. */
  openTab(url?: string): Promise<{ tabId: string }>;
  /** Tears a manual tab down. No-op for an unknown `tabId` or for a session tab's id — those only go through `destroy`. */
  closeTab(tabId: string): Promise<void>;
  /** Tears down every tab, session and manual alike — used at app quit and workspace switch, where sessions are killed in bulk without going through `destroy` per session. */
  destroyAll(): Promise<void>;
  navigate(tabId: string, url: string): Promise<void>;
  /** Positions the view within the app window. No-op if never created for that `tabId`. */
  setBounds(tabId: string, bounds: EmbeddedBrowserBounds): void;
  status(tabId: string): EmbeddedBrowserStatus | null;
}
