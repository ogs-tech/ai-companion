import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Tooltip, Typography, type Theme } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Square, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { ContainerFooter, FooterLink } from '../ds/ContainerChrome.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { InlinePermission } from './InlinePermission.js';
import { useSettings } from '../../hooks/use-settings.js';
import { resolveSessionSettings } from '../../../shared/settings.js';
import { ExternalConsentBanner, ExternalSessionRows, externalStateOf } from './ExternalSessionsBlock.js';
import { useExternalSessions } from '../../hooks/use-external-sessions.js';
import { SessionRow } from './SessionRow.js';
import { StateGlyph } from '../SessionStateMark.js';
import { useSessions, sessionsQueryKey } from '../../hooks/use-sessions.js';
import { useWorkspaces } from '../../hooks/use-workspaces.js';
import {
  useInfiniteScrollSentinel,
  useSessionHistory,
  useSessionHistoryStats,
} from '../../hooks/use-session-history.js';
import { defaultHistoryFilters } from '../../lib/history-period.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import {
  compareRows,
  countByFilter,
  FILTER_LABELS,
  matchesFilter,
  rowStateOf,
  SESSION_FILTERS,
  type SessionFilter,
  type SessionRowState,
} from '../../lib/session-attention.js';
import { closeSessionTab } from '../../lib/browser-tabs-store.js';
import { formatCostUsd } from '../../lib/format-session-history.js';
import type { HistoryScope, SessionHistoryEntry } from '../../../shared/session-history.js';
import type { SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';
import type { Workspace } from '../../../shared/workspace.js';

interface SessionsTreeGroupProps {
  /** Which conversations this panel covers — the open workspace's, or Global's (`personal`) at Início. */
  scope: HistoryScope;
  /** Opens/focuses this session's own Workbench tab — the same "un-minimize" gesture whether the session is running or exited. */
  onOpen: (session: SessionSnapshot) => void;
  /** Called after a session is apagada, so the caller can close its Workbench tab too, if one is open. */
  onRemoved?: (sessionId: string) => void;
  /** Opens the `Histórico` tab, where the same data gets a dashboard and filters. */
  onSeeAll?: () => void;
}

/**
 * A 22px bordered button on a raised surface: bare icons at the row's
 * secondary ink nearly vanish on the dark theme, and the actions are the one
 * thing on the row the user came to hover for.
 */
const actionButtonSx = (color: 'text.primary' | 'error.main') => (theme: Theme) => ({
  display: 'inline-grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  cursor: 'pointer',
  borderRadius: '6px',
  border: `1px solid ${theme.palette.divider}`,
  bgcolor: theme.palette.action.selected,
  color,
  '&:hover': { bgcolor: theme.palette.action.hover, borderColor: theme.palette.text.secondary },
  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
});

/** How long "Desfazer" stays available before the session is really removed. */
const UNDO_WINDOW_MS = 6000;

const FILTER_COLORS: Record<SessionFilter, string> = {
  'needs-input': 'warning.main',
  working: 'success.main',
  idle: 'info.main',
  exited: 'text.secondary',
};

/** One row of the list, however many sources it was assembled from. */
interface MergedRow {
  key: string;
  label: string;
  status: 'running' | 'exited';
  /** Present when this conversation is in this workspace's memory and can be stopped/removed. */
  live: SessionSnapshot | null;
  /** Present once the CLI has written a transcript for it. */
  history: SessionHistoryEntry | null;
  sortAt: number;
  /** Attention state shown by the row's indicator, bar and chip counts. */
  state: SessionRowState;
  /** When a `needs-input` session started waiting. */
  waitingSince: number | null;
  /** When an `idle` session stopped, for "há 3min". */
  idleSince: number | null;
  workingSince: number | null;
}

/**
 * Every `claude` conversation in scope, live and past alike, as one list.
 *
 * Two sources, one list: `session.list` knows what is running in this
 * process's memory, `sessionHistory.list` knows what the CLI has on disk. A
 * running session is in both and must appear once — they are merged on
 * `conversationId`, with memory winning on status and label, and the
 * transcript contributing model, cost and duration.
 *
 * Ordered by time rather than by name. Alphabetical order survives three live
 * sessions and collapses at sixty-nine.
 */
export function SessionsTreeGroup({
  scope,
  onOpen,
  onRemoved,
  onSeeAll,
}: SessionsTreeGroupProps): React.ReactElement {
  const { data: liveSessions } = useSessions();
  const { data: workspaces } = useWorkspaces();
  const { data: external } = useExternalSessions();
  const { data: settings } = useSettings();
  const inlineAnswerEnabled = resolveSessionSettings(settings ?? null).inlineAnswer;
  const externalList = useMemo(() => external?.sessions ?? [], [external]);
  // Same default period as the Histórico tab this panel links to.
  const filters = useMemo(() => defaultHistoryFilters(new Date()), []);
  const history = useSessionHistory(scope, filters);
  const stats = useSessionHistoryStats(scope, filters);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const historyEntries = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page?.entries ?? []),
    [history.data],
  );

  // Sessions the user just apagou: hidden at once (and out of the chip counts),
  // actually removed only when the undo window closes.
  const [pendingRemoval, setPendingRemoval] = useState<ReadonlySet<string>>(new Set());
  const pendingTimers = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; session: SessionSnapshot }>(),
  );
  const liveScoped = useMemo(
    () => liveInScope(liveSessions ?? [], scope).filter((s) => !pendingRemoval.has(s.sessionId)),
    [liveSessions, scope, pendingRemoval],
  );
  const rows = useMemo(() => mergeRows(liveScoped, historyEntries), [liveScoped, historyEntries]);
  const [filter, setFilter] = useState<SessionFilter | null>(null);
  const counts = useMemo(() => {
    const loaded = countByFilter([...rows.map((r) => r.state), ...externalList.map(externalStateOf)]);
    // History arrives page by page, so the loaded rows undercount. Every
    // session not loaded yet is a past one, i.e. encerrada — add the gap so the
    // chip stays put while the list scrolls in.
    const claimed = rows.filter((r) => r.live && r.history).length;
    const total = liveScoped.length + (stats.data?.sessionCount ?? 0) - claimed;
    return { ...loaded, exited: loaded.exited + Math.max(0, total - rows.length) };
  }, [rows, liveScoped, externalList, stats.data?.sessionCount]);
  const visibleRows = useMemo(
    () => rows.filter((r) => matchesFilter(r.state, filter)),
    [rows, filter],
  );
  // Ticks only while a live row shows a duration ("precisa de você · 4min", "há 3min"), so
  // those stay honest without a global timer.
  const [now, setNow] = useState(() => Date.now());
  const hasDurations = rows.some((r) => r.live && r.state !== 'exited') || externalList.some((e) => !e.closed);
  useEffect(() => {
    if (!hasDurations) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [hasDurations]);

  const sentinelRef = useInfiniteScrollSentinel(
    () => {
      if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
    },
    history.hasNextPage === true && filter === 'exited',
  );

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    await queryClient.invalidateQueries({ queryKey: ['session-history'] });
    await queryClient.invalidateQueries({ queryKey: ['session-history-stats'] });
  };

  const reportError = (err: unknown): void => {
    setToast({
      variant: 'error',
      message: err instanceof IpcCallError ? err.message : String(err),
    });
  };

  const handleOpen = async (row: MergedRow): Promise<void> => {
    try {
      if (row.live && row.live.status === 'running') {
        onOpen(row.live);
        return;
      }
      // Either an exited session still in memory, or one that only exists as
      // a transcript — both reopen by resuming the conversation itself.
      const resumed = row.live
        ? await callIpc<SessionSnapshotWithOutput>('session.resume', {
            sessionId: row.live.sessionId,
          })
        : await callIpc<SessionSnapshotWithOutput>('sessionHistory.resume', {
            conversationId: row.history!.conversationId,
          });
      await invalidate();
      // Resuming turns an encerrada into a live one, which the `×` filter would
      // hide: drop the filter so the row stays in view instead of vanishing.
      setFilter(null);
      onOpen(resumed);
    } catch (err) {
      reportError(err);
    }
  };

  const handleStop = async (session: SessionSnapshot): Promise<void> => {
    try {
      await callIpc('session.kill', { sessionId: session.sessionId });
      await invalidate();
    } catch (err) {
      reportError(err);
    }
  };

  const unmarkPending = (sessionId: string): void =>
    setPendingRemoval((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });

  const commitRemoval = async (session: SessionSnapshot): Promise<void> => {
    pendingTimers.current.delete(session.sessionId);
    try {
      await callIpc('session.remove', { sessionId: session.sessionId });
      // `SessionService.remove` already tears the embedded browser down
      // main-process side when it was enabled — this just forgets the tab on
      // the renderer's own store, which `session.remove` has no other way to reach.
      closeSessionTab(session.sessionId);
      await invalidate();
      onRemoved?.(session.sessionId);
    } catch (err) {
      reportError(err);
    } finally {
      unmarkPending(session.sessionId);
    }
  };

  const handleRemove = (session: SessionSnapshot): void => {
    setPendingRemoval((prev) => new Set(prev).add(session.sessionId));
    const timer = setTimeout(() => void commitRemoval(session), UNDO_WINDOW_MS);
    pendingTimers.current.set(session.sessionId, { timer, session });
    setToast({
      variant: 'success',
      message: 'Sessão apagada',
      action: {
        label: 'Desfazer',
        onClick: () => {
          clearTimeout(timer);
          pendingTimers.current.delete(session.sessionId);
          unmarkPending(session.sessionId);
          setToast(null);
        },
      },
    });
  };

  // Closing the panel must not turn "apagada" into "not apagada": flush what is pending.
  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      for (const { timer, session } of timers.values()) {
        clearTimeout(timer);
        void callIpc('session.remove', { sessionId: session.sessionId }).catch(() => undefined);
      }
      timers.clear();
    };
  }, []);

  if (history.isError && rows.length === 0) {
    return (
      <Box sx={{ px: 1.5, py: 1 }} data-testid="sessions-history-error">
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Não consegui ler o histórico. A pasta <code>~/.claude/projects</code> não respondeu. As
          sessões abertas agora continuam funcionando.
        </Typography>
        <Box
          component="button"
          type="button"
          data-testid="sessions-history-retry"
          onClick={() => void history.refetch()}
          sx={{
            mt: 0.75,
            border: 0,
            bgcolor: 'transparent',
            p: 0,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          <Typography variant="caption" sx={{ color: 'primary.main' }}>
            Tentar de novo
          </Typography>
        </Box>
      </Box>
    );
  }

  if (rows.length === 0 && externalList.length === 0 && !history.isLoading) {
    return (
      <>
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="sessions-empty"
          sx={{ display: 'block', px: 1.5, py: 1 }}
        >
          Nenhuma sessão ainda — abra uma com <strong>+</strong> e ela aparece aqui com o custo
          assim que a primeira resposta chegar.
        </Typography>
        <Toast toast={toast} durationMs={UNDO_WINDOW_MS} onDismiss={() => setToast(null)} />
      </>
    );
  }

  return (
    // The rows scroll in their own box; the footer below is a fixed sibling,
    // never a descendant of it. Nesting the footer inside the same scroll
    // area as the sentinel means reaching it scrolls the sentinel into view
    // first, which loads another page and pushes the footer away again — at
    // 178 sessions that is "scroll through all of them to reach Ver todas",
    // not a rare edge case.
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Stack
        direction="row"
        data-testid="sessions-filters"
        sx={{ gap: 0.625, px: 1.5, pb: 0.75, flexWrap: 'wrap' }}
      >
        {SESSION_FILTERS.map((key) => {
          const active = filter === key;
          const count = counts[key];
          const color = FILTER_COLORS[key];
          return (
            <Tooltip key={key} title={FILTER_LABELS[key]}>
              <Box
                component="button"
                type="button"
                aria-pressed={active}
                aria-label={`${FILTER_LABELS[key]}: ${count}`}
                data-testid={`sessions-filter-${key}`}
                onClick={() => setFilter(active ? null : key)}
                sx={(theme) => ({
                  font: 'inherit',
                  fontSize: '0.71875rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.625,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  borderRadius: '12px',
                  px: 1,
                  py: 0.125,
                  border: `1px solid ${active ? theme.palette.text.secondary : theme.palette.divider}`,
                  bgcolor: active ? theme.palette.action.selected : 'transparent',
                  color: theme.palette.text.primary,
                  opacity: count === 0 ? 0.4 : 1,
                  fontVariantNumeric: 'tabular-nums',
                  '&:focus-visible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: 1,
                  },
                })}
              >
                <Box component="span" aria-hidden sx={{ color, display: 'inline-flex' }}>
                  <StateGlyph state={key} />
                </Box>
                {count}
              </Box>
            </Tooltip>
          );
        })}
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {external?.consent === 'unset' && <ExternalConsentBanner />}
        <Stack spacing={0.25} sx={{ px: 0.75, pb: 0.5 }}>
          <ExternalSessionRows
            sessions={externalList}
            filter={filter}
            now={now}
            onAssumed={(snapshot) => {
              setFilter(null);
              void invalidate();
              onOpen(snapshot);
            }}
            onError={(message) => setToast({ variant: 'error', message })}
          />
          {visibleRows.map((row) => (
            <Fragment key={row.key}>
            <SessionRow
              testId={`tree-session-${row.key}`}
              label={row.label}
              harness={row.live?.harness ?? row.history?.harness ?? 'claude'}
              scopeName={scopeNameOf(row.live, scope, workspaces)}
              state={row.state}
              attention={row.live?.attention}
              waitingSince={row.waitingSince}
              idleSince={row.idleSince}
              workingSince={row.workingSince}
              activityDetail={row.live?.activityDetail}
              metrics={row.live?.metrics}
              now={now}
              history={row.history}
              onOpen={() => void handleOpen(row)}
              actions={
                row.live ? (
                  // One action per state: a running session can only be stopped, an
                  // ended one can only be deleted.
                  row.live.status === 'running' ? (
                    <Tooltip title="Encerrar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Encerrar ${row.label}`}
                        data-testid={`tree-session-stop-${row.key}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStop(row.live!);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          void handleStop(row.live!);
                        }}
                        sx={actionButtonSx('text.primary')}
                      >
                        <Icon glyph={Square} size={13} />
                      </Box>
                    </Tooltip>
                  ) : (
                    <Tooltip title="Apagar">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label={`Apagar ${row.label}`}
                        data-testid={`tree-session-remove-${row.key}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(row.live!);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          if (e.key === ' ') e.preventDefault();
                          e.stopPropagation();
                          handleRemove(row.live!);
                        }}
                        sx={actionButtonSx('error.main')}
                      >
                        <Icon glyph={Trash2} size={13} />
                      </Box>
                    </Tooltip>
                  )
                ) : null
              }
            />
            {inlineAnswerEnabled && row.live?.permissionRequest && row.live.harness === 'claude' && (
              <InlinePermission session={row.live} onOpenSession={() => void handleOpen(row)} />
            )}
            </Fragment>
          ))}

          {/*
          Three skeletons occupying exactly the height the real rows will take,
          so nothing shifts when the page arrives. They do not pulse: this
          panel is read dozens of times a day and motion here becomes a tic.
        */}
          {(history.isFetchingNextPage || history.isLoading) &&
            [0, 1, 2].map((i) => (
              <Box
                key={`skeleton-${i}`}
                data-testid="session-row-skeleton"
                sx={{ height: 40, px: 1.25, py: 0.75 }}
              />
            ))}

          <Box ref={sentinelRef} data-testid="sessions-scroll-sentinel" sx={{ height: 1 }} />
        </Stack>
      </Box>

      <ContainerFooter testId="sessions-footer">
        <Typography component="span" sx={{ fontSize: 'inherit', color: 'inherit' }}>
          <Box
            component="span"
            data-testid="sessions-total"
            sx={(theme) => ({
              fontFamily: theme.ogs.fonts.mono,
              fontWeight: 500,
              color: 'text.primary',
              fontVariantNumeric: 'tabular-nums',
            })}
          >
            {stats.data ? formatCostUsd(stats.data.totalCostUsd) : '—'}
          </Box>{' '}
          estimado
          {stats.data && stats.data.unpricedCount > 0
            ? `, ${stats.data.unpricedCount} sem preço`
            : ''}
        </Typography>
        {onSeeAll && stats.data && (
          <FooterLink testId="sessions-see-all" onClick={onSeeAll}>
            {stats.data.sessionCount === 1
              ? 'Ver a sessão'
              : `Ver as ${stats.data.sessionCount} sessões`}
          </FooterLink>
        )}
      </ContainerFooter>
      <Toast toast={toast} durationMs={UNDO_WINDOW_MS} onDismiss={() => setToast(null)} />
    </Box>
  );
}

/**
 * Folds the in-memory sessions and the on-disk transcripts into one ordered
 * list, keyed on `conversationId` so a running session — which is in both —
 * appears once.
 */
export function liveInScope(
  live: readonly SessionSnapshot[],
  scope: HistoryScope,
): readonly SessionSnapshot[] {
  // Running sessions outlive a switch of scope, so every one of them is listed
  // wherever you are — that is how a session in another workspace asking for
  // you stays visible. An ended one is only history, and belongs to its own scope.
  return live.filter((s) => s.status === 'running' || scope.kind !== 'workspace' || s.scopeId === scope.workspaceId);
}

/** The scope a list is looking at: a workspace's id, or `null` at Início. */
export function currentScopeId(scope: HistoryScope): string | null {
  return scope.kind === 'workspace' ? scope.workspaceId : null;
}

function mergeRows(
  live: readonly SessionSnapshot[],
  history: readonly SessionHistoryEntry[],
): MergedRow[] {
  const byConversation = new Map<string, SessionHistoryEntry>();
  for (const entry of history) byConversation.set(entry.conversationId, entry);

  const rows: MergedRow[] = [];
  const claimed = new Set<string>();

  for (const session of live) {
    const entry = byConversation.get(session.conversationId) ?? null;
    if (entry) claimed.add(session.conversationId);
    const state = rowStateOf(session);
    rows.push({
      key: session.sessionId,
      state,
      waitingSince: session.activity === 'needs-input' ? (session.activitySince ?? null) : null,
      idleSince: state === 'idle' ? (session.activitySince ?? null) : null,
      workingSince: state === 'working' ? (session.activitySince ?? null) : null,
      // Memory wins on label: it knows the anchor this session was opened
      // from, which is more meaningful here than the CLI's generated title.
      label: session.label,
      status: session.status,
      live: session,
      history: entry,
      // A session with no transcript yet was spawned seconds ago, so it sorts
      // to the top rather than to the bottom.
      sortAt: entry ? Date.parse(entry.endedAt) : Number.MAX_SAFE_INTEGER,
    });
  }

  for (const entry of history) {
    if (claimed.has(entry.conversationId)) continue;
    rows.push({
      key: entry.conversationId,
      label: entry.title ?? entry.conversationId.slice(0, 8),
      status: 'exited',
      live: null,
      history: entry,
      state: rowStateOf(null),
      waitingSince: null,
      idleSince: null,
      workingSince: null,
      sortAt: Date.parse(entry.endedAt),
    });
  }

  return rows.sort(compareRows);
}

/** The scope a row belongs to when it is not the one being looked at, for the row's second line. */
function scopeNameOf(
  live: SessionSnapshot | null,
  scope: HistoryScope,
  workspaces: readonly Workspace[] | undefined,
): string | undefined {
  if (!live || live.scopeId === currentScopeId(scope)) return undefined;
  if (live.scopeId === null) return 'Início';
  return workspaces?.find((w) => w.id === live.scopeId)?.name ?? 'Workspace';
}
