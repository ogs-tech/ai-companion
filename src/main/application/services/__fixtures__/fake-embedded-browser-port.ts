import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserPort,
  EmbeddedBrowserStatus,
} from '../../ports/embedded-browser-port.js';

export class FakeEmbeddedBrowserPort implements EmbeddedBrowserPort {
  createCalls: string[] = [];
  destroyCalls: string[] = [];
  openTabCalls: Array<string | undefined> = [];
  closeTabCalls: string[] = [];
  navigateCalls: Array<[string, string]> = [];
  setBoundsCalls: Array<[string, EmbeddedBrowserBounds]> = [];
  destroyAllCalls = 0;

  private nextCreateFailure: Error | null = null;
  private readonly created = new Set<string>();
  private readonly manualTabs = new Set<string>();
  private readonly statuses = new Map<string, EmbeddedBrowserStatus>();
  private pathCounter = 0;
  private tabCounter = 0;

  failNextCreate(error: Error): void {
    this.nextCreateFailure = error;
  }

  async create(sessionId: string): Promise<{ mcpConfigPath: string }> {
    this.createCalls.push(sessionId);
    if (this.nextCreateFailure) {
      const err = this.nextCreateFailure;
      this.nextCreateFailure = null;
      throw err;
    }
    this.created.add(sessionId);
    this.pathCounter += 1;
    return { mcpConfigPath: `/tmp/browser-mcp-${sessionId}-${this.pathCounter}/config.json` };
  }

  async destroy(sessionId: string): Promise<void> {
    this.destroyCalls.push(sessionId);
    this.created.delete(sessionId);
    this.statuses.delete(sessionId);
  }

  async openTab(url?: string): Promise<{ tabId: string }> {
    this.openTabCalls.push(url);
    this.tabCounter += 1;
    const tabId = `tab-${this.tabCounter}`;
    this.manualTabs.add(tabId);
    if (url) this.statuses.set(tabId, { url });
    return { tabId };
  }

  async closeTab(tabId: string): Promise<void> {
    this.closeTabCalls.push(tabId);
    this.manualTabs.delete(tabId);
    this.statuses.delete(tabId);
  }

  async destroyAll(): Promise<void> {
    this.destroyAllCalls += 1;
    this.created.clear();
    this.manualTabs.clear();
    this.statuses.clear();
  }

  async navigate(id: string, url: string): Promise<void> {
    this.navigateCalls.push([id, url]);
    this.statuses.set(id, { url });
  }

  setBounds(id: string, bounds: EmbeddedBrowserBounds): void {
    this.setBoundsCalls.push([id, bounds]);
  }

  status(id: string): EmbeddedBrowserStatus | null {
    return this.statuses.get(id) ?? null;
  }
}
