import type { BrowserWindow } from 'electron';
import { WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { WritableFileSystemPort } from '../../application/ports/writable-filesystem-port.js';
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserPort,
  EmbeddedBrowserStatus,
} from '../../application/ports/embedded-browser-port.js';

interface Tab {
  view: WebContentsView;
  /** Set only for a session tab — `undefined` for a manual one. */
  tempDir?: string;
  mcpConfigPath?: string;
}

export interface EmbeddedBrowserAdapterOptions {
  /** The app's single main window — every tab's view is added to it as a child view. */
  getMainWindow: () => BrowserWindow | null;
  fs: WritableFileSystemPort;
  /** Absolute path to the pinned `@playwright/mcp` binary (this app's own `node_modules/.bin`) — never resolved via `npx`. */
  playwrightMcpBin: string;
  /** The app-wide `--remote-debugging-port` value, set once at Electron startup before `app.whenReady()`. */
  cdpPort: number;
}

const DEFAULT_URL = 'about:blank';
const ZERO_BOUNDS: EmbeddedBrowserBounds = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Owns every embedded browser tab: one `WebContentsView` each, added as a
 * child view of the app's single main window. Positioning is purely a
 * function of the renderer's own `setBounds` calls (one per tab, driven by
 * that tab's `BrowserPane` — zero while its Workbench tab is hidden, real
 * once shown) — this class has no notion of "the active tab", just a pool of
 * independently-positioned views, so a session's agent can keep driving its
 * own tab in the background regardless of which one the user is looking at.
 *
 * A session tab additionally owns the ephemeral `--mcp-config` file that
 * points a `claude` CLI spawn at this app's own CDP endpoint (`app-wide
 * --remote-debugging-port`, set once at startup — see `index.ts`). Manual
 * navigation and the agent's Playwright MCP tool act on the same
 * `WebContentsView`, neither a proxy of the other.
 *
 * Deliberately does *not* call `webContents.debugger.attach()` on a session
 * tab's view: that's Electron's separate in-process CDP channel, and
 * attaching it alongside the network-exposed `--remote-debugging-port` an
 * external CDP client (the spawned `@playwright/mcp` process) also targets
 * risks the two sessions fighting over the same target. The network port
 * alone is what `@playwright/mcp --cdp-endpoint` needs.
 */
export class EmbeddedBrowserAdapter implements EmbeddedBrowserPort {
  private readonly tabs = new Map<string, Tab>();

  constructor(private readonly opts: EmbeddedBrowserAdapterOptions) {}

  async create(sessionId: string): Promise<{ mcpConfigPath: string }> {
    const existing = this.tabs.get(sessionId);
    if (existing?.mcpConfigPath) return { mcpConfigPath: existing.mcpConfigPath };

    // Written before the view is attached to the window: if this fails
    // (e.g. disk full), there is nothing to tear down yet — no orphaned view
    // left behind, unreachable by `destroy` because it was never tracked.
    const tempDir = await this.opts.fs.makeTempDir('browser-mcp-');
    const mcpConfigPath = join(tempDir, 'config.json');
    const config = {
      mcpServers: {
        playwright: {
          command: this.opts.playwrightMcpBin,
          args: ['--cdp-endpoint', `ws://127.0.0.1:${this.opts.cdpPort}/`],
        },
      },
    };
    await this.opts.fs.writeFile(mcpConfigPath, JSON.stringify(config, null, 2));

    this.tabs.set(sessionId, { view: this.createView(DEFAULT_URL), tempDir, mcpConfigPath });
    return { mcpConfigPath };
  }

  async destroy(sessionId: string): Promise<void> {
    const tab = this.tabs.get(sessionId);
    if (!tab) return;
    this.tabs.delete(sessionId);
    this.teardownView(tab.view);
    if (tab.tempDir) await this.opts.fs.remove(tab.tempDir).catch(() => {});
  }

  async openTab(url?: string): Promise<{ tabId: string }> {
    const tabId = randomUUID();
    this.tabs.set(tabId, { view: this.createView(url ?? DEFAULT_URL) });
    return { tabId };
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    // A session tab only ever goes through `destroy` — closing one here would
    // tear the view down without also clearing `browserMcpConfigPaths` on the
    // `SessionService` side, leaving that session pointed at a dead config.
    if (!tab || tab.mcpConfigPath) return;
    this.tabs.delete(tabId);
    this.teardownView(tab.view);
  }

  async destroyAll(): Promise<void> {
    await Promise.all(
      Array.from(this.tabs.entries(), ([id, tab]) =>
        tab.mcpConfigPath ? this.destroy(id) : this.closeTab(id),
      ),
    );
  }

  async navigate(tabId: string, url: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    await tab.view.webContents.loadURL(url);
  }

  setBounds(tabId: string, bounds: EmbeddedBrowserBounds): void {
    this.tabs.get(tabId)?.view.setBounds(bounds);
  }

  status(tabId: string): EmbeddedBrowserStatus | null {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    return { url: tab.view.webContents.getURL() };
  }

  private createView(url: string): WebContentsView {
    const mainWindow = this.opts.getMainWindow();
    if (!mainWindow) {
      throw new Error('Cannot create an embedded browser before the app window exists');
    }
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.contentView.addChildView(view);
    // Hidden until the renderer's BrowserPane reports its real position via
    // `browser.setBounds` — a zero-size view avoids a visible flash at (0,0).
    view.setBounds(ZERO_BOUNDS);
    void view.webContents.loadURL(url);
    return view;
  }

  private teardownView(view: WebContentsView): void {
    this.opts.getMainWindow()?.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}
