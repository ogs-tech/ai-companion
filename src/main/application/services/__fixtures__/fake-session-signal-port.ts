import type { SessionSignal, SessionSignalListener, SessionSignalPort } from '../../ports/session-signal-port.js';

export class FakeSessionSignalPort implements SessionSignalPort {
  prepared: string[] = [];
  released: string[] = [];
  private listener: SessionSignalListener | null = null;

  async prepare(sessionId: string): Promise<string> {
    this.prepared.push(sessionId);
    return `/signals/${sessionId}.jsonl`;
  }

  async release(sessionId: string): Promise<void> {
    this.released.push(sessionId);
  }

  onSignal(listener: SessionSignalListener): void {
    this.listener = listener;
  }

  emit(sessionId: string, signal: SessionSignal): void {
    this.listener?.(sessionId, signal);
  }
}
