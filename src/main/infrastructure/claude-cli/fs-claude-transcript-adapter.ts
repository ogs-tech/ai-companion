import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SessionTranscriptPort,
  TranscriptModelUsage,
  TranscriptRef,
  TranscriptUsage,
} from '../../application/ports/session-transcript-port.js';

/**
 * How much of a file's head is read to find its `cwd`. Every transcript
 * carries `cwd` on its first content-bearing line; measured across every
 * transcript on a real machine the deepest was 5,099 bytes in, so this is
 * roughly 3x the observed worst case.
 */
const HEAD_BUDGET_BYTES = 16 * 1024;
/**
 * How much of a file's tail is read to find its cost, models and title.
 *
 * The CLI re-appends `cost-state`, `ai-title` and `last-prompt` on every
 * turn, so the last copy of each is always near the end however long the
 * conversation ran. Measured across every transcript on a real machine: the
 * final `cost-state` was never more than 915 bytes from EOF, and the final
 * title never more than 33 KB. This is ~8x that worst case — enough margin
 * that a longer future prompt still lands inside it, and still nothing next
 * to the 63 MB such a file can reach.
 */
const TAIL_BUDGET_BYTES = 256 * 1024;
/** A `last-prompt` standing in for a missing title is clipped to something a one-line row can hold. */
const FALLBACK_TITLE_MAX_CHARS = 80;

interface JsonlLine {
  type?: unknown;
  [key: string]: unknown;
}

/** Parses JSONL, skipping unparseable lines — a partial flush during a live session is normal, not an error. */
function parseJsonl(text: string): JsonlLine[] {
  const out: JsonlLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.push(parsed as JsonlLine);
    } catch {
      // Skip malformed lines — a half-written last line is expected while a session is live.
    }
  }
  return out;
}

function lastOfType(lines: readonly JsonlLine[], type: string): JsonlLine | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line?.type === type) return line;
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === code;
}

/**
 * Reads the `claude` CLI's own conversation transcripts.
 *
 * The whole design of this adapter is about never reading the middle of a
 * file. A transcript is append-only JSONL and can reach tens of megabytes,
 * but everything this app needs sits at one end or the other: `cwd` on the
 * first content-bearing line, and cost/models/title on lines the CLI
 * re-appends every turn, which therefore always trail the file. So a
 * conversation is summarised from a 16 KB head plus a 256 KB tail regardless
 * of its size — the difference between opening the panel instantly and
 * parsing hundreds of megabytes to draw ten rows.
 *
 * The one exception is a transcript written by a CLI old enough not to have
 * recorded its own cost; those fall back to summing every assistant line, and
 * are re-read in full. They are a shrinking minority (26 of 169 on the machine
 * this was measured against) and the result is cached by mtime and size.
 *
 * `projectsDir` is injected rather than derived from `homedir()` here, matching
 * every other adapter in this codebase: the composition root owns path
 * resolution, which is also what makes this testable against a temp tree.
 */
export class FsClaudeTranscriptAdapter implements SessionTranscriptPort {
  constructor(private readonly projectsDir: string) {}

  async listRefs(): Promise<TranscriptRef[]> {
    let projectDirs: string[];
    try {
      const entries = await readdir(this.projectsDir, { withFileTypes: true });
      projectDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (err) {
      // No `~/.claude/projects` at all — the CLI has simply never run here.
      if (hasCode(err, 'ENOENT') || hasCode(err, 'ENOTDIR')) return [];
      throw err;
    }

    const refs: TranscriptRef[] = [];
    for (const dir of projectDirs) {
      const dirPath = join(this.projectsDir, dir);
      let files: string[];
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        // Only this level: a `<project>/<sessionId>/subagents/*.jsonl` is a
        // subagent's transcript, not a session, and carries no cost of its own.
        files = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
          .map((entry) => entry.name);
      } catch {
        continue; // A project folder that vanished or can't be read shouldn't take the whole listing down.
      }

      for (const file of files) {
        const ref = await this.readRef(join(dirPath, file), file.replace(/\.jsonl$/, ''));
        if (ref) refs.push(ref);
      }
    }
    return refs;
  }

  private async readRef(filePath: string, claudeSessionId: string): Promise<TranscriptRef | null> {
    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      return null;
    }
    const cwd = await this.readCwd(filePath, stats.size);
    // A transcript with no `cwd` anywhere in its head can't be placed in a
    // scope, and every real one has it on its first content-bearing line —
    // so this is an empty or truncated file, and it is dropped rather than
    // guessed at from the (lossy) folder name.
    if (!cwd) return null;
    return {
      claudeSessionId,
      filePath,
      cwd,
      modifiedAt: new Date(stats.mtimeMs).toISOString(),
      mtimeMs: stats.mtimeMs,
      sizeBytes: stats.size,
    };
  }

  private async readCwd(filePath: string, size: number): Promise<string | null> {
    const head = await readSlice(filePath, 0, Math.min(size, HEAD_BUDGET_BYTES));
    if (head === null) return null;
    for (const line of parseJsonl(head)) {
      const cwd = asNonEmptyString(line['cwd']);
      if (cwd) return cwd;
    }
    return null;
  }

  async readUsage(ref: TranscriptRef): Promise<TranscriptUsage> {
    const tailStart = Math.max(0, ref.sizeBytes - TAIL_BUDGET_BYTES);
    const tail = await readSlice(ref.filePath, tailStart, ref.sizeBytes - tailStart);
    // A slice that doesn't start at byte 0 opens mid-line; that fragment is
    // not valid JSON and `parseJsonl` drops it, which is exactly right.
    const lines = tail === null ? [] : parseJsonl(tail);

    const title = readTitle(lines);
    const costState = lastOfType(lines, 'cost-state');
    if (costState) return fromCostState(costState, title, ref);

    // Old transcript, or one that never reached the API: reconstruct from the
    // assistant lines themselves. This is the only path that reads it whole.
    return this.sumAssistantLines(ref, title);
  }

  private async sumAssistantLines(ref: TranscriptRef, tailTitle: string | null): Promise<TranscriptUsage> {
    const whole = await readSlice(ref.filePath, 0, ref.sizeBytes);
    const lines = whole === null ? [] : parseJsonl(whole);

    const byModel = new Map<string, TranscriptModelUsage>();
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;

    for (const line of lines) {
      const timestamp = asNonEmptyString(line['timestamp']);
      if (timestamp) {
        firstTimestamp ??= timestamp;
        lastTimestamp = timestamp;
      }
      if (line.type !== 'assistant') continue;
      const message = line['message'];
      if (!isRecord(message)) continue;
      const usage = message['usage'];
      if (!isRecord(usage)) continue;
      const model = asNonEmptyString(message['model']);
      if (!model) continue;

      const entry = byModel.get(model) ?? {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reportedCostUsd: null,
      };
      entry.inputTokens += asFiniteNumber(usage['input_tokens']);
      entry.outputTokens += asFiniteNumber(usage['output_tokens']);
      entry.cacheCreationTokens += asFiniteNumber(usage['cache_creation_input_tokens']);
      entry.cacheReadTokens += asFiniteNumber(usage['cache_read_input_tokens']);
      byModel.set(model, entry);
    }

    const startedAt = firstTimestamp ?? ref.modifiedAt;
    const endedAt = lastTimestamp ?? ref.modifiedAt;
    return {
      title: tailTitle ?? readTitle(lines),
      models: [...byModel.values()],
      reportedCostUsd: null,
      startedAt,
      endedAt,
      durationMs: durationBetween(startedAt, endedAt),
    };
  }
}

/** The CLI's own name for the conversation, falling back to the opening of its last prompt. */
function readTitle(lines: readonly JsonlLine[]): string | null {
  const custom = lastOfType(lines, 'custom-title');
  const customTitle = custom && asNonEmptyString(custom['customTitle']);
  if (customTitle) return customTitle;

  const ai = lastOfType(lines, 'ai-title');
  const aiTitle = ai && asNonEmptyString(ai['aiTitle']);
  if (aiTitle) return aiTitle;

  const prompt = lastOfType(lines, 'last-prompt');
  const lastPrompt = prompt && asNonEmptyString(prompt['lastPrompt']);
  if (!lastPrompt) return null;
  const firstLine = lastPrompt.split('\n')[0]?.trim() ?? lastPrompt;
  return firstLine.length > FALLBACK_TITLE_MAX_CHARS
    ? `${firstLine.slice(0, FALLBACK_TITLE_MAX_CHARS).trimEnd()}…`
    : firstLine;
}

/**
 * Reads a conversation's summary straight from the `cost-state` line the CLI
 * appends after every turn — its own totals, not a reconstruction of them.
 */
function fromCostState(costState: JsonlLine, title: string | null, ref: TranscriptRef): TranscriptUsage {
  const modelUsage = costState['modelUsage'];
  const models: TranscriptModelUsage[] = [];
  if (isRecord(modelUsage)) {
    for (const [model, raw] of Object.entries(modelUsage)) {
      if (!isRecord(raw)) continue;
      models.push({
        model,
        inputTokens: asFiniteNumber(raw['inputTokens']),
        outputTokens: asFiniteNumber(raw['outputTokens']),
        cacheCreationTokens: asFiniteNumber(raw['cacheCreationInputTokens']),
        cacheReadTokens: asFiniteNumber(raw['cacheReadInputTokens']),
        reportedCostUsd: asOptionalNumber(raw['costUSD']),
      });
    }
  }

  const startTime = asOptionalNumber(costState['startTime']);
  const durationMs = asOptionalNumber(costState['totalDuration']);
  const startedAt = startTime === null ? ref.modifiedAt : new Date(startTime).toISOString();
  return {
    title,
    models,
    // `hasUnknownModelCost` means the CLI itself couldn't price part of this
    // conversation, so its total is an undercount — refuse it rather than
    // report a number that is quietly too low, and let the price table try.
    reportedCostUsd: costState['hasUnknownModelCost'] === true ? null : asOptionalNumber(costState['totalCostUSD']),
    startedAt,
    endedAt: ref.modifiedAt,
    durationMs,
  };
}

function durationBetween(startedAt: string, endedAt: string): number | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Reads `length` bytes from `position`, returning null when the file is gone or unreadable. */
async function readSlice(filePath: string, position: number, length: number): Promise<string | null> {
  if (length <= 0) return '';
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
