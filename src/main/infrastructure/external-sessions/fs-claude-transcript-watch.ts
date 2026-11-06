import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { TranscriptChange, TranscriptWatchPort } from '../../application/ports/external-session-ports.js';
import { EXTERNAL_TAIL_BYTES } from '../../../shared/external-session.js';

const THROTTLE_MS = 500;

/** Reads at most the last `maxBytes` of a file as text (the first, possibly cut, line is dropped when it did not start at 0). */
async function readTail(file: string, maxBytes: number): Promise<{ text: string; mtimeMs: number } | null> {
  let handle;
  try {
    handle = await open(file, 'r');
    const { size, mtimeMs } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    let text = buffer.toString('utf8');
    if (size > maxBytes) text = text.slice(text.indexOf('\n') + 1);
    return { text, mtimeMs };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** `cwd` from the newest transcript entry that has one (Claude writes it on every message). */
export function cwdFromTail(text: string): string | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.includes('"cwd"')) continue;
    try {
      const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
      if (typeof cwd === 'string' && cwd.startsWith('/')) return cwd;
    } catch {
      // A partial line; try the one before.
    }
  }
  return null;
}

/**
 * Fallback with no hooks: one recursive watcher on `~/.claude/projects`, reading
 * only the last ~8 KB of a transcript that changed. State derived from this is
 * an estimate (the service labels it so).
 */
export class FsClaudeTranscriptWatch implements TranscriptWatchPort {
  private listener: ((change: TranscriptChange) => void) | null = null;
  private watcher: FSWatcher | null = null;
  private readonly paths = new Map<string, string>();
  private readonly lastRead = new Map<string, number>();

  constructor(private readonly projectsDir: string) {}

  onChange(listener: (change: TranscriptChange) => void): void {
    this.listener = listener;
  }

  async start(): Promise<void> {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.projectsDir, { recursive: true }, (_event, name) => {
        if (typeof name === 'string' && name.endsWith('.jsonl') && !name.includes('/subagents/')) void this.changed(join(this.projectsDir, name));
      });
      this.watcher.on('error', () => {});
    } catch {
      // No ~/.claude/projects yet (Claude never ran): nothing to watch.
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.lastRead.clear();
  }

  async tail(id: string, maxBytes: number): Promise<string> {
    const file = this.paths.get(id) ?? (await this.find(id));
    if (!file) return '';
    return (await readTail(file, maxBytes))?.text ?? '';
  }

  private async changed(file: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastRead.get(file) ?? 0) < THROTTLE_MS) return;
    this.lastRead.set(file, now);
    const tail = await readTail(file, EXTERNAL_TAIL_BYTES);
    if (!tail) return;
    const id = basename(file, '.jsonl');
    this.paths.set(id, file);
    this.listener?.({ id, harness: 'claude', cwd: cwdFromTail(tail.text), modifiedAt: tail.mtimeMs });
  }

  private async find(id: string): Promise<string | null> {
    for (const project of await readdir(this.projectsDir).catch(() => [] as string[])) {
      const file = join(this.projectsDir, project, `${id}.jsonl`);
      if (await stat(file).then(() => true, () => false)) {
        this.paths.set(id, file);
        return file;
      }
    }
    return null;
  }
}
