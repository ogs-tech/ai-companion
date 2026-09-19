import { useMemo, useState } from 'react';
import { Box, Divider, Stack, Tooltip, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Square, Trash2 } from 'lucide-react';
import { Icon } from '../ds/Icon.js';
import { Toast, type ToastMessage } from '../Toast.js';
import { SessionRow } from './SessionRow.js';
import { useSessions, sessionsQueryKey } from '../../hooks/use-sessions.js';
import {
  useInfiniteScrollSentinel,
  useSessionHistory,
  useSessionHistoryStats,
} from '../../hooks/use-session-history.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import { formatCostUsd } from '../../lib/format-session-history.js';
import type { HistoryScope, SessionHistoryEntry } from '../../../shared/session-history.js';
import type { SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';

interface SessionsTreeGroupProps {
  /** Which conversations this panel covers — the project in view, or the workspace when none is. */
  scope: HistoryScope;
  /** Opens/focuses this session's own Workbench tab — the same "un-minimize" gesture whether the session is running or exited. */
  onOpen: (session: SessionSnapshot) => void;
  /** Called after a session is apagada, so the caller can close its Workbench tab too, if one is open. */
  onRemoved?: (sessionId: string) => void;
  /** Opens the `Histórico` tab, where the same data gets a dashboard and filters. */
  onSeeAll?: () => void;
}

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
}

/**
 * Every `claude` conversation in scope, live and past alike, as one list.
 *
 * Two sources, one list: `session.list` knows what is running in this
 * process's memory, `sessionHistory.list` knows what the CLI has on disk. A
 * running session is in both and must appear once — they are merged on
 * `claudeSessionId`, with memory winning on status and label, and the
 * transcript contributing model, cost and duration.
 *
 * Ordered by time rather than by name. Alphabetical order survives three live
 * sessions and collapses at sixty-nine.
 */
export function SessionsTreeGroup({ scope, onOpen, onRemoved, onSeeAll }: SessionsTreeGroupProps): React.ReactElement {
  const { data: liveSessions } = useSessions();
  const history = useSessionHistory(scope);
  const stats = useSessionHistoryStats(scope);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const historyEntries = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page?.entries ?? []),
    [history.data],
  );

  const rows = useMemo(
    () => mergeRows(liveSessions ?? [], historyEntries),
    [liveSessions, historyEntries],
  );

  const sentinelRef = useInfiniteScrollSentinel(
    () => {
      if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
    },
    history.hasNextPage === true,
  );

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    await queryClient.invalidateQueries({ queryKey: ['session-history'] });
    await queryClient.invalidateQueries({ queryKey: ['session-history-stats'] });
  };

  const reportError = (err: unknown): void => {
    setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
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
        ? await callIpc<SessionSnapshotWithOutput>('session.resume', { sessionId: row.live.sessionId })
        : await callIpc<SessionSnapshotWithOutput>('sessionHistory.resume', {
            claudeSessionId: row.history!.claudeSessionId,
          });
      await invalidate();
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

  const handleRemove = async (session: SessionSnapshot): Promise<void> => {
    if (!window.confirm(`Apagar a sessão de ${session.label}? O histórico desta sessão será perdido.`)) return;
    try {
      await callIpc('session.remove', { sessionId: session.sessionId });
      await invalidate();
      onRemoved?.(session.sessionId);
    } catch (err) {
      reportError(err);
    }
  };

  if (history.isError && rows.length === 0) {
    return (
      <Box sx={{ px: 1.5, py: 1 }} data-testid="sessions-history-error">
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Não consegui ler o histórico. A pasta <code>~/.claude/projects</code> não respondeu. As sessões abertas agora
          continuam funcionando.
        </Typography>
        <Box
          component="button"
          type="button"
          data-testid="sessions-history-retry"
          onClick={() => void history.refetch()}
          sx={{ mt: 0.75, border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', font: 'inherit' }}
        >
          <Typography variant="caption" sx={{ color: 'primary.main' }}>
            Tentar de novo
          </Typography>
        </Box>
      </Box>
    );
  }

  if (rows.length === 0 && !history.isLoading) {
    return (
      <Typography
        variant="caption"
        color="text.secondary"
        data-testid="sessions-empty"
        sx={{ display: 'block', px: 1.5, py: 1 }}
      >
        Nenhuma sessão ainda — abra uma com <strong>+</strong> e ela aparece aqui com o custo assim que a primeira
        resposta chegar.
      </Typography>
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
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <Stack spacing={0.25} sx={{ px: 0.75, pb: 0.5 }}>
        {rows.map((row) => (
          <SessionRow
            key={row.key}
            testId={`tree-session-${row.key}`}
            label={row.label}
            status={row.status}
            history={row.history}
            onOpen={() => void handleOpen(row)}
            actions={
              row.live ? (
                <>
                  {row.live.status === 'running' && (
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
                        sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                      >
                        <Icon glyph={Square} size={13} />
                      </Box>
                    </Tooltip>
                  )}
                  <Tooltip title="Apagar">
                    <Box
                      component="span"
                      role="button"
                      tabIndex={0}
                      aria-label={`Apagar ${row.label}`}
                      data-testid={`tree-session-remove-${row.key}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemove(row.live!);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if (e.key === ' ') e.preventDefault();
                        e.stopPropagation();
                        void handleRemove(row.live!);
                      }}
                      sx={{ display: 'inline-flex', p: 0.5, cursor: 'pointer' }}
                    >
                      <Icon glyph={Trash2} size={13} />
                    </Box>
                  </Tooltip>
                </>
              ) : null
            }
          />
        ))}

        {/*
          Three skeletons occupying exactly the height the real rows will take,
          so nothing shifts when the page arrives. They do not pulse: this
          panel is read dozens of times a day and motion here becomes a tic.
        */}
        {(history.isFetchingNextPage || history.isLoading) &&
          [0, 1, 2].map((i) => (
            <Box key={`skeleton-${i}`} data-testid="session-row-skeleton" sx={{ height: 40, px: 1.25, py: 0.75 }} />
          ))}

        <Box ref={sentinelRef} data-testid="sessions-scroll-sentinel" sx={{ height: 1 }} />
      </Stack>
      </Box>

      <Divider />
      <Stack
        direction="row"
        data-testid="sessions-footer"
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.75, gap: 1, flexShrink: 0 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="div"
            data-testid="sessions-total"
            sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.8125rem', color: 'text.primary' })}
          >
            {stats.data ? formatCostUsd(stats.data.totalCostUsd) : '—'}
          </Typography>
          <Typography sx={{ fontSize: '0.625rem', color: 'text.secondary' }}>
            estimado
            {stats.data && stats.data.unpricedCount > 0 ? ` · ${stats.data.unpricedCount} sem preço` : ''}
          </Typography>
        </Box>
        {onSeeAll && stats.data && (
          <Box
            component="button"
            type="button"
            data-testid="sessions-see-all"
            onClick={onSeeAll}
            sx={{ border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', font: 'inherit', flexShrink: 0 }}
          >
            <Typography sx={{ fontSize: '0.6875rem', color: 'primary.main' }}>
              Ver todas as {stats.data.sessionCount}
            </Typography>
          </Box>
        )}
      </Stack>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Box>
  );
}

/**
 * Folds the in-memory sessions and the on-disk transcripts into one ordered
 * list, keyed on `claudeSessionId` so a running session — which is in both —
 * appears once.
 */
function mergeRows(live: readonly SessionSnapshot[], history: readonly SessionHistoryEntry[]): MergedRow[] {
  const byConversation = new Map<string, SessionHistoryEntry>();
  for (const entry of history) byConversation.set(entry.claudeSessionId, entry);

  const rows: MergedRow[] = [];
  const claimed = new Set<string>();

  for (const session of live) {
    const entry = byConversation.get(session.claudeSessionId) ?? null;
    if (entry) claimed.add(session.claudeSessionId);
    rows.push({
      key: session.sessionId,
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
    if (claimed.has(entry.claudeSessionId)) continue;
    rows.push({
      key: entry.claudeSessionId,
      label: entry.title ?? entry.claudeSessionId.slice(0, 8),
      status: 'exited',
      live: null,
      history: entry,
      sortAt: Date.parse(entry.endedAt),
    });
  }

  return rows.sort((a, b) => b.sortAt - a.sortAt);
}
