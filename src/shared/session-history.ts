/**
 * Which conversations a history query covers. `project`/`workspace` match a
 * conversation by the directory it ran in — including anything below it, so a
 * session opened in a subfolder still belongs to its project. `all` is every
 * conversation the CLI has ever recorded on this machine.
 */
export type HistoryScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'all' };

export interface HistoryFilters {
  /** Model ids, as the transcripts spell them. Empty or absent means every model. */
  models?: string[];
  /** ISO date (inclusive), matched against when the conversation last moved. */
  from?: string;
  /** ISO date (inclusive). */
  to?: string;
  /** Free text, matched against the conversation's title and directory. */
  search?: string;
}

/**
 * Where a row's cost figure came from — the difference between a reading and
 * a reconstruction, which the UI states rather than hides.
 */
export type CostSource =
  /** The CLI's own total, recorded in the transcript. */
  | 'reported'
  /** Reconstructed from token counts and a bundled price table. */
  | 'estimated'
  /** A model with no published rate; there is no number to show. */
  | 'unknown';

/** One past conversation, as a history row sees it. */
export interface SessionHistoryEntry {
  claudeSessionId: string;
  /** The CLI's own name for it, or the opening of its last prompt; `null` when it has neither. */
  title: string | null;
  cwd: string;
  /** The model it spent the most output on; `null` when it never reached the API. */
  model: string | null;
  costUsd: number | null;
  costSource: CostSource;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  startedAt: string;
  endedAt: string;
  durationMs: number | null;
}

export interface SessionHistoryPage {
  entries: SessionHistoryEntry[];
  /**
   * Opaque. Pass it back to resume after the last row of this page; `null`
   * means there is no next page.
   *
   * A cursor rather than an offset because a live session writes to its
   * transcript while the list is open and jumps to the top of the ordering —
   * an offset would then skip or repeat a row mid-scroll, an anchor cannot.
   */
  nextCursor: string | null;
  /** How many conversations match the query in total, across every page. */
  total: number;
}

export interface SessionHistoryDayTotal {
  /** `YYYY-MM-DD`, in the machine's local timezone. */
  date: string;
  costUsd: number;
  sessionCount: number;
}

export interface SessionHistoryStats {
  /** Total across every conversation that could be priced. */
  totalCostUsd: number;
  /** How many matching conversations could not be priced and are therefore missing from the total. */
  unpricedCount: number;
  sessionCount: number;
  perDay: SessionHistoryDayTotal[];
  /** Every model appearing in scope, for the filter pills. */
  models: string[];
}

export interface SessionHistoryQuery {
  scope: HistoryScope;
  filters?: HistoryFilters;
  cursor?: string;
  limit?: number;
}

/** The Control Panel and the `Histórico` tab both page ten rows at a time. */
export const SESSION_HISTORY_PAGE_SIZE = 10;
