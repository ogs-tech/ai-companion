/**
 * One `claude` conversation as it exists on disk, located and dated without
 * reading its body.
 */
export interface TranscriptRef {
  /** The `.jsonl` basename — the same UUID the CLI was handed via `--session-id`. */
  claudeSessionId: string;
  filePath: string;
  /**
   * The directory the conversation ran in, read from inside the file.
   *
   * Never decoded from the folder name: the CLI builds that name by replacing
   * path separators with hyphens (`/Users/me/ai-companion` →
   * `-Users-me-ai-companion`), which is lossy — a directory whose own name
   * contains a hyphen is indistinguishable from a separator. The folder name
   * is an index, nothing more.
   */
  cwd: string;
  /** ISO, from `stat().mtime` — when the conversation last moved. */
  modifiedAt: string;
  /** Raw `stat()` values, kept so a cached reading can be invalidated without re-reading the file. */
  mtimeMs: number;
  sizeBytes: number;
}

/** What one model was asked to do within one conversation. */
export interface TranscriptModelUsage {
  /** The model id exactly as the transcript spells it, suffixes and all (`claude-opus-5[1m]`). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Cost as the CLI itself computed it; `null` on a transcript written before the CLI recorded one. */
  reportedCostUsd: number | null;
}

/** A conversation's own summary of itself — what it cost, on what, and under what name. */
export interface TranscriptUsage {
  /** The CLI's name for the conversation, or a trimmed opening of the last prompt; `null` when it got neither. */
  title: string | null;
  /** One entry per model used. Empty when the conversation never reached the API. */
  models: TranscriptModelUsage[];
  /**
   * The CLI's own total for the conversation. `null` means the transcript
   * predates the CLI recording one and the cost has to be estimated from
   * tokens instead — see `estimateCost`.
   */
  reportedCostUsd: number | null;
  /** ISO. */
  startedAt: string;
  /** ISO. */
  endedAt: string;
  /** Wall-clock length of the conversation, when the transcript reported one. */
  durationMs: number | null;
}

/**
 * Reads the transcripts the `claude` CLI writes for every conversation, under
 * `~/.claude/projects/<slug>/<uuid>.jsonl`.
 *
 * Read-only by contract: this app never writes into the CLI's own directory.
 * Both calls are cheap by construction — see `FsClaudeTranscriptAdapter` for
 * why neither one reads the middle of a file, which is where all the bulk is.
 */
export interface SessionTranscriptPort {
  /** Every conversation on disk, located and dated. Never parses a conversation's body. */
  listRefs(): Promise<TranscriptRef[]>;
  /** One conversation's own summary of itself. */
  readUsage(ref: TranscriptRef): Promise<TranscriptUsage>;
}
