import { useMemo, useState } from 'react';
import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { History, Play } from 'lucide-react';
import { EntityDataGrid } from '../../components/EntityDataGrid/index.js';
import type { EntityDef, RowAction } from '../../components/EntityDataGrid/index.js';
import { EmptyState } from '../../components/ds/EmptyState.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { SpendBarChart } from './SpendBarChart.js';
import { useSessionHistoryAll, useSessionHistoryStats } from '../../hooks/use-session-history.js';
import { sessionsQueryKey } from '../../hooks/use-sessions.js';
import { callIpc, IpcCallError } from '../../lib/ipc.js';
import {
  describeCostSource,
  formatCostUsd,
  formatDuration,
  formatModel,
  formatTokens,
  formatWhen,
} from '../../lib/format-session-history.js';
import { DEFAULT_PERIOD, PERIODS, periodRange, type PeriodId } from '../../lib/history-period.js';
import type {
  HistoryFilters,
  HistoryScope,
  SessionHistoryEntry,
} from '../../../shared/session-history.js';
import type { SessionSnapshot, SessionSnapshotWithOutput } from '../../../shared/session.js';
import { HarnessMark } from '../../components/HarnessMark.js';
import { HARNESSES, type HarnessId } from '../../../shared/harness.js';

interface SessionHistoryTabProps {
  /** The scope the panel is showing — what `Só este projeto` means here. */
  projectScope: HistoryScope | null;
  onOpenSession: (session: SessionSnapshot) => void;
}

/**
 * The spend dashboard: what these conversations cost, when, and on what.
 *
 * Opens scoped to the project in view, because that is the question being
 * asked most of the time; turning `Só este projeto` off widens it to every
 * conversation on the machine. The table is sorted by cost descending rather
 * than by date — the question is "what was expensive", so the answer is the
 * first row.
 */
export function SessionHistoryTab({
  projectScope,
  onOpenSession,
}: SessionHistoryTabProps): React.ReactElement {
  // At Início the scope is already `all`, so "only this project" would mean nothing.
  const hasProject = projectScope !== null && projectScope.kind !== 'all';
  const [projectOnly, setProjectOnly] = useState(hasProject);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<HarnessId | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodId>(DEFAULT_PERIOD);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Fixed for the lifetime of the tab so the query keys stay stable.
  const today = useMemo(() => new Date(), []);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const queryClient = useQueryClient();

  const scope: HistoryScope =
    projectOnly && hasProject && projectScope ? projectScope : { kind: 'all' };

  // The chart always shows the unfiltered-by-day picture: a day filter is a
  // lens on the table, not a change to the period being charted.
  const range = useMemo(
    () => periodRange(period, today, customFrom, customTo),
    [period, today, customFrom, customTo],
  );
  const chartFilters = useMemo<HistoryFilters | undefined>(() => {
    const filters: HistoryFilters = { ...range };
    if (selectedModel) filters.models = [selectedModel];
    if (selectedHarness) filters.harnesses = [selectedHarness];
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [selectedModel, selectedHarness, range]);
  const tableFilters = useMemo<HistoryFilters | undefined>(() => {
    const filters: HistoryFilters = { ...range };
    if (selectedModel) filters.models = [selectedModel];
    if (selectedHarness) filters.harnesses = [selectedHarness];
    if (selectedDay) {
      filters.from = `${selectedDay}T00:00:00.000`;
      filters.to = `${selectedDay}T23:59:59.999`;
    }
    return Object.keys(filters).length > 0 ? filters : undefined;
  }, [selectedModel, selectedHarness, selectedDay, range]);

  const stats = useSessionHistoryStats(scope, chartFilters);
  const entries = useSessionHistoryAll(scope, tableFilters);

  const rows = useMemo(
    () => [...(entries.data?.entries ?? [])].sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1)),
    [entries.data],
  );

  const handleResume = async (entry: SessionHistoryEntry): Promise<void> => {
    try {
      const resumed = await callIpc<SessionSnapshotWithOutput>('sessionHistory.resume', {
        conversationId: entry.conversationId,
      });
      await queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      onOpenSession(resumed);
    } catch (err) {
      setToast({
        variant: 'error',
        message: err instanceof IpcCallError ? err.message : String(err),
      });
    }
  };

  const entity: EntityDef<SessionHistoryEntry> = useMemo(
    () => ({
      name: 'sessão',
      pluralName: 'sessões',
      defaultView: 'table',
      getKey: (item) => item.conversationId,
      fields: [
        {
          key: 'title',
          label: 'Sessão',
          primary: true,
          searchable: true,
          render: (item) => item.title ?? item.conversationId.slice(0, 8),
        },
        {
          key: 'costUsd',
          label: 'Custo',
          align: 'right',
          width: 110,
          render: (item) => (
            <Typography
              component="span"
              title={describeCostSource(item.costSource, item.harness)}
              sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.8125rem' })}
            >
              {formatCostUsd(item.costUsd)}
            </Typography>
          ),
        },
        {
          key: 'harness',
          label: 'Harness',
          width: 110,
          render: (item) => (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <HarnessMark harness={item.harness} size={13} />
              <span>{HARNESSES[item.harness].displayName}</span>
            </Stack>
          ),
        },
        { key: 'model', label: 'Modelo', width: 130, render: (item) => formatModel(item.model) },
        {
          key: 'outputTokens',
          label: 'Tokens',
          align: 'right',
          width: 100,
          render: (item) => (
            <Typography
              component="span"
              sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.75rem' })}
            >
              {formatTokens(item.inputTokens + item.outputTokens)}
            </Typography>
          ),
        },
        {
          key: 'durationMs',
          label: 'Duração',
          align: 'right',
          width: 90,
          render: (item) => formatDuration(item.durationMs),
        },
        {
          key: 'endedAt',
          label: 'Quando',
          align: 'right',
          width: 90,
          render: (item) => formatWhen(item.endedAt),
        },
        { key: 'cwd', label: 'Pasta', searchable: true, hideInTable: true },
      ],
    }),
    [],
  );

  const actions: RowAction<SessionHistoryEntry>[] = useMemo(
    () => [
      { label: 'Retomar', icon: <Play size={14} />, onClick: (item) => void handleResume(item) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <Stack
      spacing={2.5}
      data-testid="session-history-tab"
      sx={{ p: 2, height: '100%', overflowY: 'auto' }}
    >
      <Box>
        <Kicker>Gasto {projectOnly && hasProject ? 'neste projeto' : 'em tudo'}</Kicker>
        <Typography
          data-testid="history-total"
          sx={(theme) => ({
            fontFamily: theme.ogs.fonts.mono,
            fontSize: 40,
            lineHeight: 1.1,
            mt: 0.5,
          })}
        >
          {stats.data ? formatCostUsd(stats.data.totalCostUsd) : '—'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          estimado · {stats.data?.sessionCount ?? 0}{' '}
          {stats.data?.sessionCount === 1 ? 'sessão' : 'sessões'}
          {stats.data && stats.data.unpricedCount > 0
            ? ` · ${stats.data.unpricedCount} sem preço publicado, fora do total`
            : ''}
        </Typography>
      </Box>

      <SpendBarChart
        perDay={stats.data?.perDay ?? []}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        {PERIODS.map(({ id, label }) => (
          <Chip
            key={id}
            size="small"
            data-testid={`filter-period-${id}`}
            label={label}
            color={period === id ? 'primary' : 'default'}
            variant={period === id ? 'filled' : 'outlined'}
            onClick={() => {
              setPeriod(id);
              setSelectedDay(null);
            }}
          />
        ))}
        <Chip
          size="small"
          data-testid="filter-period-custom"
          label="Personalizado"
          color={period === 'custom' ? 'primary' : 'default'}
          variant={period === 'custom' ? 'filled' : 'outlined'}
          onClick={() => {
            setPeriod('custom');
            setSelectedDay(null);
          }}
        />
        {period === 'custom' && (
          <>
            <TextField
              size="small"
              type="date"
              label="De"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { 'data-testid': 'filter-from', max: customTo || undefined },
              }}
            />
            <TextField
              size="small"
              type="date"
              label="Até"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { 'data-testid': 'filter-to', min: customFrom || undefined },
              }}
            />
          </>
        )}
        {hasProject && (
          <Chip
            size="small"
            data-testid="filter-project-only"
            label="Só este projeto"
            color={projectOnly ? 'primary' : 'default'}
            variant={projectOnly ? 'filled' : 'outlined'}
            onClick={() => setProjectOnly((on) => !on)}
          />
        )}
        {(stats.data?.harnesses ?? []).map((harness) => (
          <Chip
            key={harness}
            size="small"
            data-testid={`filter-harness-${harness}`}
            icon={<HarnessMark harness={harness} size={12} />}
            label={HARNESSES[harness].displayName}
            color={selectedHarness === harness ? 'primary' : 'default'}
            variant={selectedHarness === harness ? 'filled' : 'outlined'}
            onClick={() => setSelectedHarness((current) => (current === harness ? null : harness))}
          />
        ))}
        {(stats.data?.models ?? []).map((model) => (
          <Chip
            key={model}
            size="small"
            data-testid={`filter-model-${model}`}
            label={formatModel(model)}
            color={selectedModel === model ? 'primary' : 'default'}
            variant={selectedModel === model ? 'filled' : 'outlined'}
            onClick={() => setSelectedModel((current) => (current === model ? null : model))}
          />
        ))}
        {selectedDay && (
          <Chip
            size="small"
            data-testid="filter-day"
            label={`Dia ${selectedDay}`}
            color="primary"
            onDelete={() => setSelectedDay(null)}
          />
        )}
      </Stack>

      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <EntityDataGrid<SessionHistoryEntry>
          entity={entity}
          data={rows}
          isLoading={entries.isLoading}
          error={entries.error}
          actions={actions}
          searchPlaceholder="Buscar por título ou pasta"
          onRowClick={(item) => void handleResume(item)}
          emptyState={
            <EmptyState
              glyph={History}
              title="Nenhuma sessão aqui"
              description="Abra uma sessão e ela aparece com o custo assim que a primeira resposta chegar."
              testId="session-history"
            />
          }
        />
      </Box>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </Stack>
  );
}
