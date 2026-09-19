import type { BrowserWindow } from 'electron';
import { WebContentsView } from 'electron';
import { join } from 'node:path';
import type { WritableFileSystemPort } from '../../application/ports/writable-filesystem-port.js';
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserPort,
  EmbeddedBrowserStatus,
} from '../../application/ports/embedded-browser-port.js';

interface SessionBrowser {
  view: WebContentsView;
  tempDir: string;
  mcpConfigPath: string;
}

export interface EmbeddedBrowserAdapterOptions {
  /** The app's single main window — every session's view is added to it as a child view. */
  getMainWindow: () => BrowserWindow | null;
  fs: WritableFileSystemPort;
  /** Absolute path to the pinned `@playwright/mcp` binary (this app's own `node_modules/.bin`) — never resolved via `npx`. */
  playwrightMcpBin: string;
  /** The app-wide `--remote-debugging-port` value, set once at Electron startup before `app.whenReady()`. */
  cdpPort: number;
}

const DEFAULT_URL = 'about:blank';

/**
 * Owns the per-session embedded browser: one `WebContentsView`, added as a
 * child view of the app's single main window, plus the ephemeral
 * `--mcp-config` file that points a `claude` CLI spawn at this app's own CDP
 * endpoint (`app-wide --remote-debugging-port`, set once at startup — see
 * `index.ts`). Manual navigation and the agent's Playwright MCP tool act on
 * the same `WebContentsView`, neither a proxy of the other.
 *
 * Deliberately does *not* call `webContents.debugger.attach()` on the view:
 * that's Electron's separate in-process CDP channel, and attaching it
 * alongside the network-exposed `--remote-debugging-port` an external CDP
 * client (the spawned `@playwright/mcp` process) also targets risks the two
 * sessions fighting over the same target. The network port alone is what
 * `@playwright/mcp --cdp-endpoint` needs.
 */
export class EmbeddedBrowserAdapter implements EmbeddedBrowserPort {
  private readonly sessions = new Map<string, SessionBrowser>();

  constructor(private readonly opts: EmbeddedBrowserAdapterOptions) {}

  async create(sessionId: string): Promise<{ mcpConfigPath: string }> {
    const existing = this.sessions.get(sessionId);
    if (existing) return { mcpConfigPath: existing.mcpConfigPath };

    const mainWindow = this.opts.getMainWindow();
    if (!mainWindow) {
      throw new Error('Cannot create an embedded browser before the app window exists');
    }

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

    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.contentView.addChildView(view);
    // Hidden until the renderer's BrowserPane reports its real position via
    // `browser.setBounds` — a zero-size view avoids a visible flash at (0,0).
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    void view.webContents.loadURL(DEFAULT_URL);

    this.sessions.set(sessionId, { view, tempDir, mcpConfigPath });
    return { mcpConfigPath };
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.teardownView(session.view);
    await this.opts.fs.remove(session.tempDir).catch(() => {});
  }

  async destroyAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys(), (sessionId) => this.destroy(sessionId)));
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.view.webContents.loadURL(url);
  }

  setBounds(sessionId: string, bounds: EmbeddedBrowserBounds): void {
    this.sessions.get(sessionId)?.view.setBounds(bounds);
  }

  status(sessionId: string): EmbeddedBrowserStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { url: session.view.webContents.getURL() };
  }

  private teardownView(view: WebContentsView): void {
    this.opts.getMainWindow()?.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}
