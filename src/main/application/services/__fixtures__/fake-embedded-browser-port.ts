import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserPort,
  EmbeddedBrowserStatus,
} from '../../ports/embedded-browser-port.js';

export class FakeEmbeddedBrowserPort implements EmbeddedBrowserPort {
  createCalls: string[] = [];
  destroyCalls: string[] = [];
  navigateCalls: Array<[string, string]> = [];
  setBoundsCalls: Array<[string, EmbeddedBrowserBounds]> = [];
  destroyAllCalls = 0;

  private nextCreateFailure: Error | null = null;
  private readonly created = new Set<string>();
  private readonly statuses = new Map<string, EmbeddedBrowserStatus>();
  private pathCounter = 0;

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

  async destroyAll(): Promise<void> {
    this.destroyAllCalls += 1;
    this.created.clear();
    this.statuses.clear();
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    this.navigateCalls.push([sessionId, url]);
    this.statuses.set(sessionId, { url });
  }

  setBounds(sessionId: string, bounds: EmbeddedBrowserBounds): void {
    this.setBoundsCalls.push([sessionId, bounds]);
  }

  status(sessionId: string): EmbeddedBrowserStatus | null {
    return this.statuses.get(sessionId) ?? null;
  }
}
