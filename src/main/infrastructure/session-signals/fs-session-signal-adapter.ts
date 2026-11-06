import { watch, type FSWatcher } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSignalListener, SessionSignalPort } from '../../application/ports/session-signal-port.js';
import { parseSignalLine } from '../../application/session-activity.js';

interface Channel {
  file: string;
  watcher: FSWatcher;
  /** Bytes already consumed. */
  offset: number;
  /** A trailing partial line waiting for its newline. */
  pending: string;
  reading: boolean;
  dirty: boolean;
}

/**
 * Signal channel as one append-only file per session under `dir`. Hooks `>>`
 * lines into it; this adapter tails it. File names are `encodeURIComponent`'d
 * session ids, because entity-anchored ids contain `:`.
 */
export class FsSessionSignalAdapter implements SessionSignalPort {
  private readonly channels = new Map<string, Channel>();
  private listener: SessionSignalListener | null = null;

  constructor(private readonly dir: string) {}

  onSignal(listener: SessionSignalListener): void {
    this.listener = listener;
  }

  async prepare(sessionId: string): Promise<string> {
    const existing = this.channels.get(sessionId);
    if (existing) return existing.file;
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${encodeURIComponent(sessionId)}.jsonl`);
    // A stale file from a previous run must not replay old signals.
    await writeFile(file, '');
    const channel: Channel = { file, watcher: watch(file, () => this.schedule(sessionId)), offset: 0, pending: '', reading: false, dirty: false };
    channel.watcher.on('error', () => {});
    this.channels.set(sessionId, channel);
    return file;
  }

  /** The waiting hook polls for `<channel>.decision` and prints the verdict; writing atomically (temp + rename) means it never reads a half-written word. */
  async answer(sessionId: string, decision: 'allow' | 'deny'): Promise<void> {
    const channel = this.channels.get(sessionId);
    if (!channel) return;
    const temp = `${channel.file}.decision.tmp`;
    await writeFile(temp, decision);
    await rename(temp, `${channel.file}.decision`);
  }

  async release(sessionId: string): Promise<void> {
    const channel = this.channels.get(sessionId);
    if (!channel) return;
    this.channels.delete(sessionId);
    channel.watcher.close();
    await rm(channel.file, { force: true });
    await rm(`${channel.file}.decision`, { force: true });
  }

  private schedule(sessionId: string): void {
    const channel = this.channels.get(sessionId);
    if (!channel) return;
    if (channel.reading) {
      channel.dirty = true;
      return;
    }
    channel.reading = true;
    void this.drain(sessionId, channel).finally(() => {
      channel.reading = false;
      if (channel.dirty) {
        channel.dirty = false;
        this.schedule(sessionId);
      }
    });
  }

  private async drain(sessionId: string, channel: Channel): Promise<void> {
    let handle;
    try {
      handle = await open(channel.file, 'r');
      const { size } = await handle.stat();
      if (size <= channel.offset) return;
      const buffer = Buffer.alloc(size - channel.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, channel.offset);
      channel.offset += bytesRead;
      const lines = (channel.pending + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      channel.pending = lines.pop() ?? '';
      for (const line of lines) {
        const signal = parseSignalLine(line);
        if (signal) this.listener?.(sessionId, signal);
      }
    } catch {
      // The file vanished (released) or is mid-write; the next change event retries.
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}
