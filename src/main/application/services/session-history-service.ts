import { sep } from 'node:path';
import type {
  HistoryFilters,
  HistoryScope,
  SessionHistoryDayTotal,
  SessionHistoryEntry,
  SessionHistoryPage,
  SessionHistoryQuery,
  SessionHistoryStats,
} from '../../../shared/session-history.js';
import { SESSION_HISTORY_PAGE_SIZE } from '../../../shared/session-history.js';
import type {
  SessionTranscriptPort,
  TranscriptRef,
  TranscriptUsage,
} from '../ports/session-transcript-port.js';
import type { ModelRate } from '../pricing/model-pricing.js';
import { primaryModel, resolveCostUsd } from '../pricing/model-pricing.js';
import type { SettingsService } from './settings-service.js';
import type { WorkspaceService } from './workspace-service.js';
import type { ProjectService } from './project-service.js';
import { DomainError } from '../../domain/errors.js';

/** A ref paired with its reading, ordered and filtered as one. */
interface HistoryRow {
  ref: TranscriptRef;
  entry: SessionHistoryEntry;
}

interface CachedUsage {
  mtimeMs: number;
  sizeBytes: number;
  usage: TranscriptUsage;
}

/**
 * Reads past `claude` conversations as a browsable, costed history.
 *
 * Deliberately has no on-disk cache. Summarising every transcript on a real
 * machine — 169 conversations, the largest 63 MB — measures at roughly 260 ms
 * end to end, because `FsClaudeTranscriptAdapter` never reads the middle of a
 * file. A cache file would buy a fraction of a second at the price of a
 * versioned schema, an atomic writer and a whole class of staleness bugs. The
 * in-memory map below is enough: it keeps a workspace's readings warm between
 * a `list` and the `stats` call that follows it, and a transcript whose mtime
 * or size moved is simply re-read.
 */
export class SessionHistoryService {
  private readonly usageCache = new Map<string, CachedUsage>();

  constructor(
    private readonly transcripts: SessionTranscriptPort,
    private readonly settingsService: Pick<SettingsService, 'load' | 'getDefaults'>,
    private readonly scopeDeps: {
      workspaceService: Pick<WorkspaceService, 'get'>;
      projectService: Pick<ProjectService, 'get'>;
    },
  ) {}

  async list(query: SessionHistoryQuery): Promise<SessionHistoryPage> {
    const rows = await this.rowsFor(query.scope, query.filters);
    const limit = query.limit && query.limit > 0 ? query.limit : SESSION_HISTORY_PAGE_SIZE;
    const start = query.cursor ? indexAfterCursor(rows, query.cursor) : 0;
    const slice = rows.slice(start, start + limit);
    const end = start + slice.length;
    const last = slice[slice.length - 1];
    return {
      entries: slice.map((row) => row.entry),
      nextCursor: end < rows.length && last ? encodeCursor(last) : null,
      total: rows.length,
    };
  }

  async stats(query: Pick<SessionHistoryQuery, 'scope' | 'filters'>): Promise<SessionHistoryStats> {
    const rows = await this.rowsFor(query.scope, query.filters);

    let totalCostUsd = 0;
    let unpricedCount = 0;
    const perDay = new Map<string, SessionHistoryDayTotal>();
    const models = new Set<string>();

    for (const { entry } of rows) {
      if (entry.model) models.add(entry.model);
      const day = localDay(entry.endedAt);
      const bucket = perDay.get(day) ?? { date: day, costUsd: 0, sessionCount: 0 };
      bucket.sessionCount += 1;
      if (entry.costUsd === null) {
        unpricedCount += 1;
      } else {
        totalCostUsd += entry.costUsd;
        bucket.costUsd += entry.costUsd;
      }
      perDay.set(day, bucket);
    }

    return {
      totalCostUsd,
      unpricedCount,
      sessionCount: rows.length,
      perDay: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      models: [...models].sort(),
    };
  }

  /** One conversation by id, or `undefined` — the lookup behind resuming a history row. */
  async find(claudeSessionId: string): Promise<SessionHistoryEntry | undefined> {
    const refs = await this.transcripts.listRefs();
    const ref = refs.find((candidate) => candidate.claudeSessionId === claudeSessionId);
    if (!ref) return undefined;
    const overrides = await this.rateOverrides();
    return toEntry(ref, await this.usageFor(ref), overrides);
  }

  private async rowsFor(scope: HistoryScope, filters?: HistoryFilters): Promise<HistoryRow[]> {
    const root = await this.scopeRoot(scope);
    const refs = (await this.transcripts.listRefs()).filter((ref) => inScope(ref, root));
    const overrides = await this.rateOverrides();

    const rows: HistoryRow[] = [];
    for (const ref of refs) {
      const entry = toEntry(ref, await this.usageFor(ref), overrides);
      if (matches(entry, filters)) rows.push({ ref, entry });
    }

    // Newest first, with the id as a tiebreak so two conversations written in
    // the same millisecond still have one stable order — which is what makes a
    // cursor anchored to the pair unambiguous.
    rows.sort((a, b) => {
      const byTime = b.ref.mtimeMs - a.ref.mtimeMs;
      return byTime !== 0 ? byTime : a.ref.claudeSessionId.localeCompare(b.ref.claudeSessionId);
    });
    this.evictMissing(refs);
    return rows;
  }

  private async usageFor(ref: TranscriptRef): Promise<TranscriptUsage> {
    const cached = this.usageCache.get(ref.filePath);
    if (cached && cached.mtimeMs === ref.mtimeMs && cached.sizeBytes === ref.sizeBytes) return cached.usage;
    const usage = await this.transcripts.readUsage(ref);
    this.usageCache.set(ref.filePath, { mtimeMs: ref.mtimeMs, sizeBytes: ref.sizeBytes, usage });
    return usage;
  }

  /** Keeps the warm map from growing forever as conversations are deleted from disk. */
  private evictMissing(refs: readonly TranscriptRef[]): void {
    if (this.usageCache.size <= refs.length) return;
    const alive = new Set(refs.map((ref) => ref.filePath));
    for (const key of this.usageCache.keys()) {
      if (!alive.has(key)) this.usageCache.delete(key);
    }
  }

  private async rateOverrides(): Promise<Record<string, ModelRate> | undefined> {
    const settings = (await this.settingsService.load()) ?? this.settingsService.getDefaults();
    return settings.pricing;
  }

  /** The directory a scope covers, or `null` for "everything on this machine". */
  private async scopeRoot(scope: HistoryScope): Promise<string | null> {
    if (scope.kind === 'all') return null;
    if (scope.kind === 'workspace') {
      const workspace = await this.scopeDeps.workspaceService.get(scope.workspaceId);
      return workspace.rootPath;
    }
    const project = await this.scopeDeps.projectService.get(scope.projectId);
    return project.path;
  }
}

function inScope(ref: TranscriptRef, root: string | null): boolean {
  if (root === null) return true;
  return ref.cwd === root || ref.cwd.startsWith(root.endsWith(sep) ? root : root + sep);
}

function toEntry(
  ref: TranscriptRef,
  usage: TranscriptUsage,
  overrides: Record<string, ModelRate> | undefined,
): SessionHistoryEntry {
  const costUsd = resolveCostUsd(usage, overrides);
  return {
    claudeSessionId: ref.claudeSessionId,
    title: usage.title,
    cwd: ref.cwd,
    model: primaryModel(usage),
    costUsd,
    costSource: costUsd === null ? 'unknown' : usage.reportedCostUsd !== null ? 'reported' : 'estimated',
    inputTokens: sumTokens(usage, 'inputTokens'),
    outputTokens: sumTokens(usage, 'outputTokens'),
    cacheCreationTokens: sumTokens(usage, 'cacheCreationTokens'),
    cacheReadTokens: sumTokens(usage, 'cacheReadTokens'),
    startedAt: usage.startedAt,
    endedAt: usage.endedAt,
    durationMs: usage.durationMs,
  };
}

function sumTokens(
  usage: TranscriptUsage,
  field: 'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens',
): number {
  return usage.models.reduce((total, model) => total + model[field], 0);
}

function matches(entry: SessionHistoryEntry, filters?: HistoryFilters): boolean {
  if (!filters) return true;

  if (filters.models && filters.models.length > 0) {
    if (!entry.model || !filters.models.includes(entry.model)) return false;
  }
  if (filters.from && localDay(entry.endedAt) < localDay(filters.from)) return false;
  if (filters.to && localDay(entry.endedAt) > localDay(filters.to)) return false;
  if (filters.search && filters.search.trim() !== '') {
    const needle = filters.search.trim().toLowerCase();
    const haystack = `${entry.title ?? ''} ${entry.cwd}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** `YYYY-MM-DD` in the machine's own timezone — a spend "day" is the user's day, not UTC's. */
function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function encodeCursor(row: HistoryRow): string {
  return Buffer.from(`${row.ref.mtimeMs}|${row.ref.claudeSessionId}`, 'utf8').toString('base64url');
}

/**
 * Where the next page starts: just past the row the cursor names.
 *
 * If that row is gone — deleted, or moved by a write while the list was open —
 * the ordering is still total, so the position it *would* occupy is found by
 * comparison instead, and no row is skipped or repeated.
 */
function indexAfterCursor(rows: readonly HistoryRow[], cursor: string): number {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new DomainError('validation', 'Malformed history cursor');
  }
  const separatorAt = decoded.indexOf('|');
  const mtimeMs = Number(decoded.slice(0, separatorAt));
  const claudeSessionId = decoded.slice(separatorAt + 1);
  if (separatorAt < 0 || !Number.isFinite(mtimeMs)) {
    throw new DomainError('validation', 'Malformed history cursor');
  }

  const exact = rows.findIndex((row) => row.ref.claudeSessionId === claudeSessionId);
  if (exact >= 0) return exact + 1;

  const index = rows.findIndex(
    (row) =>
      row.ref.mtimeMs < mtimeMs ||
      (row.ref.mtimeMs === mtimeMs && row.ref.claudeSessionId.localeCompare(claudeSessionId) > 0),
  );
  return index < 0 ? rows.length : index;
}
