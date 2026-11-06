import { watch, type FSWatcher } from 'node:fs';
import { mkdir, open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExternalSignal, ExternalSignalSourcePort } from '../../application/ports/external-session-ports.js';
import { parseExternalLine } from '../../application/external-hooks.js';

/** Files older than this are not replayed on start (the session is long over). */
const REPLAY_WINDOW_MS = 6 * 60 * 60 * 1000;
const REPLAY_BYTES = 16 * 1024;

/**
 * One OS-level watcher (FSEvents on macOS) on the directory external hooks
 * append to — a file per conversation, `<id>.jsonl`. Tails each file from the
 * offset it last reached; on start it replays only the tail of recent files so
 * the list is right after an app restart.
 */
export class FsExternalSignalAdapter implements ExternalSignalSourcePort {
  private listener: ((signal: ExternalSignal) => void) | null = null;
  private watcher: FSWatcher | null = null;
  private readonly offsets = new Map<string, number>();
  private readonly pending = new Map<string, string>();
  private readonly busy = new Set<string>();
  private readonly dirty = new Set<string>();

  constructor(private readonly dir: string) {}

  onSignal(listener: (signal: ExternalSignal) => void): void {
    this.listener = listener;
  }

  async start(): Promise<void> {
    if (this.watcher) return;
    await mkdir(this.dir, { recursive: true });
    this.watcher = watch(this.dir, (_event, name) => {
      if (typeof name === 'string' && name.endsWith('.jsonl')) void this.drain(name);
    });
    this.watcher.on('error', () => {});
    await this.replayRecent();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.offsets.clear();
    this.pending.clear();
  }

  private async replayRecent(): Promise<void> {
    const now = Date.now();
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!name.endsWith('.jsonl')) continue;
      const info = await stat(join(this.dir, name)).catch(() => null);
      if (!info || now - info.mtimeMs > REPLAY_WINDOW_MS) continue;
      this.offsets.set(name, Math.max(0, info.size - REPLAY_BYTES));
      await this.drain(name, info.size > REPLAY_BYTES);
    }
  }

  private async drain(name: string, skipFirstPartialLine = false): Promise<void> {
    if (this.busy.has(name)) {
      this.dirty.add(name);
      return;
    }
    this.busy.add(name);
    const file = join(this.dir, name);
    let handle;
    try {
      handle = await open(file, 'r');
      const { size } = await handle.stat();
      const offset = this.offsets.get(name) ?? 0;
      if (size < offset) this.offsets.set(name, 0); // truncated
      const from = this.offsets.get(name) ?? 0;
      if (size === from) return;
      const buffer = Buffer.alloc(size - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      this.offsets.set(name, from + bytesRead);
      const lines = ((this.pending.get(name) ?? '') + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      this.pending.set(name, lines.pop() ?? '');
      if (skipFirstPartialLine) lines.shift(); // the replay window starts mid-line
      const id = decodeURIComponent(name.slice(0, -'.jsonl'.length));
      for (const line of lines) {
        const parsed = parseExternalLine(line);
        if (parsed) this.listener?.({ id, harness: parsed.harness, signal: parsed.signal });
      }
    } catch {
      // Mid-write or gone; the next change event retries.
    } finally {
      await handle?.close().catch(() => {});
      this.busy.delete(name);
      if (this.dirty.delete(name)) void this.drain(name);
    }
  }
}
