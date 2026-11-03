import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SessionTranscriptPort,
  TranscriptRef,
  TranscriptUsage,
} from '../../application/ports/session-transcript-port.js';

interface CursorChatMeta {
  title: string | null;
  cwd: string;
  createdAtMs: number;
  updatedAtMs: number;
  hasConversation: boolean;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const asMs = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function parseMeta(raw: string): CursorChatMeta | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // A half-written meta.json during a live session is normal.
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const cwd = asString(record['cwd']);
  const createdAtMs = asMs(record['createdAtMs']);
  const updatedAtMs = asMs(record['updatedAtMs']) ?? createdAtMs;
  if (!cwd || createdAtMs === null || updatedAtMs === null) return null;
  return {
    title: asString(record['title']),
    cwd,
    createdAtMs,
    updatedAtMs,
    hasConversation: record['hasConversation'] !== false,
  };
}

/**
 * Reads the chat metadata `cursor-agent` keeps under
 * `~/.cursor/chats/<hash>/<chatId>/meta.json`. Read-only, like the Claude
 * adapter.
 *
 * Only the metadata is read: Cursor's transcripts carry no usage, model or
 * cost, so there is nothing further to summarise. {@link readUsage} says so
 * (`unpriced`) instead of reporting zeros.
 */
export class FsCursorTranscriptAdapter implements SessionTranscriptPort {
  constructor(private readonly chatsDir: string) {}

  async listRefs(): Promise<TranscriptRef[]> {
    let hashes: string[];
    try {
      hashes = await readdir(this.chatsDir);
    } catch {
      return []; // Cursor never ran on this machine.
    }
    const refs: TranscriptRef[] = [];
    for (const hash of hashes) {
      let chats: string[];
      try {
        chats = await readdir(join(this.chatsDir, hash));
      } catch {
        continue;
      }
      for (const chatId of chats) {
        const ref = await this.readRef(join(this.chatsDir, hash, chatId, 'meta.json'), chatId);
        if (ref) refs.push(ref);
      }
    }
    return refs;
  }

  private async readRef(filePath: string, chatId: string): Promise<TranscriptRef | null> {
    let raw: string;
    let size: number;
    try {
      [raw, size] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath).then((s) => s.size)]);
    } catch {
      return null;
    }
    const meta = parseMeta(raw);
    // A chat made by `create-chat` and never used would only clutter the list.
    if (!meta || !meta.hasConversation) return null;
    return {
      harness: 'cursor',
      conversationId: chatId,
      filePath,
      cwd: meta.cwd,
      modifiedAt: new Date(meta.updatedAtMs).toISOString(),
      mtimeMs: meta.updatedAtMs,
      sizeBytes: size,
    };
  }

  async readUsage(ref: TranscriptRef): Promise<TranscriptUsage> {
    const meta = parseMeta(await readFile(ref.filePath, 'utf8'));
    const startedAt = meta ? new Date(meta.createdAtMs).toISOString() : ref.modifiedAt;
    return {
      title: meta?.title ?? null,
      unpriced: true,
      models: [],
      reportedCostUsd: null,
      startedAt,
      endedAt: ref.modifiedAt,
      durationMs: null,
    };
  }
}
