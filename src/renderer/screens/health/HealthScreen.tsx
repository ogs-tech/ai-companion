import { Fragment, useState } from 'react';
import { Box, Button, CircularProgress, Container, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { CHANNELS, type ChannelId } from '../../../shared/channel.js';
import type { HealthCheck, Severity } from '../../../shared/health.js';
import { Icon } from '../../components/ds/Icon.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { Toast, type ToastMessage } from '../../components/Toast.js';
import { useHealthReport } from '../../hooks/use-health-report.js';
import { useInstallEntity, useUndoInstall } from '../../hooks/use-install-entity.js';
import { useMcpList } from '../../hooks/use-mcp-list.js';
import { useRefreshDiagnostics, type RefreshResult } from '../../hooks/use-refresh-diagnostics.js';
import { useSettings } from '../../hooks/use-settings.js';
import { causeHint, causeText, countsLabel, STATE_LABEL } from '../../lib/diagnostics-copy.js';
import { StateDot } from '../../components/ds/StateDot.js';
import { clearDiagnosticsFocus, useDiagnosticsFocus } from '../../lib/diagnostics-focus.js';
import { buildDiagnosticsMatrix, KIND_LABEL, type MatrixCell, type MatrixRow } from '../../lib/diagnostics-matrix.js';
import { IpcCallError, callIpc } from '../../lib/ipc.js';
import { openMcpPage } from '../../lib/workspace-area-store.js';

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

interface Expanded {
  rowKey: string;
  channel: ChannelId;
}

export function HealthScreen(): React.ReactElement {
  const { data, isLoading, isFetching } = useHealthReport('personal');
  const { data: settings } = useSettings();
  const refresh = useRefreshDiagnostics();
  // Arriving from a ⚠ in the tree (or the status bar popover) narrows the matrix to that item.
  const focus = useDiagnosticsFocus();
  const matrix = buildDiagnosticsMatrix({
    checks: data?.checks ?? [],
    adapters: settings?.adapters ?? {},
    ...(focus !== null ? { only: focus.urns } : {}),
  });
  // A deep link opens on its first problem, so "what is going on" is one look away; the user's own pick (per
  // focus) wins from then on. Derived, not an effect: a refetch never re-opens what the user closed.
  const focusKey = focus === null ? null : focus.urn;
  const firstProblem = focus === null ? undefined : matrix.problems[0];
  const firstCell = firstProblem?.cells.find((c) => c.severity !== null && c.severity !== 'ok');
  const fromFocus: Expanded | null = firstProblem !== undefined && firstCell !== undefined ? { rowKey: firstProblem.key, channel: firstCell.channel } : null;
  const [picked, setPicked] = useState<{ focusKey: string | null; value: Expanded | null } | null>(null);
  const expanded = picked !== null && picked.focusKey === focusKey ? picked.value : fromFocus;
  const setExpanded = (value: Expanded | null): void => setPicked({ focusKey, value });

  const rows = matrix.groups.flatMap((g) => g.rows);

  return (
    <Container component="main" data-testid="health-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader
        title="Diagnóstico"
        subtitle={data ? countsLabel(matrix.counts) : undefined}
        actions={
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon glyph={RefreshCw} size={16} />}
            data-testid="health-refresh"
            disabled={isFetching || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {focus !== null && (
        <Box data-testid="health-focus" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Mostrando apenas <Box component="span" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono })}>{focus.urn}</Box>
          </Typography>
          <Button size="small" data-testid="health-focus-clear" onClick={clearDiagnosticsFocus}>
            Ver tudo
          </Button>
        </Box>
      )}

      {refresh.data && <RefreshSummary result={refresh.data} />}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!isLoading && matrix.general.length > 0 && (
        <Box data-testid="health-general" sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          {matrix.general.map((check) => (
            <Box key={check.id} sx={{ p: 1.5, display: 'flex', gap: 1.25, alignItems: 'baseline' }}>
              <StateDot severity={check.severity} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2">{causeText(check)}</Typography>
                {check.detail !== undefined && <Mono>{check.detail}</Mono>}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {!isLoading && rows.length === 0 && (
        <Box data-testid="health-empty" sx={{ border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1, p: 4, textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="body2">
            {matrix.channels.length === 0
              ? 'Nenhum canal está recebendo customizações. Ligue um em Configurações › Canais.'
              : 'Nenhuma customização sincronizada ainda.'}
          </Typography>
        </Box>
      )}

      {!isLoading && rows.length > 0 && (
        <Box
          component="table"
          data-testid="health-matrix"
          sx={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
            fontSize: '0.8125rem',
            '& th, & td': { textAlign: 'left', px: 1.5, py: 0.875, borderTop: 1, borderColor: 'divider' },
            '& thead th': { borderTop: 0, color: 'text.secondary', fontWeight: 600, fontSize: '0.75rem' },
          }}
        >
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Customização</th>
              {matrix.channels.map((id) => (
                <th key={id}>{CHANNELS[id].displayName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.groups.map((group) => (
              <Fragment key={group.id}>
                <Box component="tr" data-testid={`health-group-${group.id}`}>
                  <Box component="td" colSpan={matrix.channels.length + 1} sx={(theme) => ({ bgcolor: theme.ogs.surfaces.input, color: 'text.secondary', fontWeight: 600, fontSize: '0.75rem' })}>
                    {group.label}
                  </Box>
                </Box>
                {group.rows.map((row) => (
                  <Fragment key={row.key}>
                    <MatrixRowView row={row} depth={0} expanded={expanded} onToggle={setExpanded} span={matrix.channels.length + 1} />
                    {row.children.map((child) => (
                      <MatrixRowView key={child.key} row={child} depth={1} expanded={expanded} onToggle={setExpanded} span={matrix.channels.length + 1} />
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Box>
      )}
    </Container>
  );
}

function MatrixRowView({
  row,
  depth,
  expanded,
  onToggle,
  span,
}: {
  row: MatrixRow;
  depth: number;
  expanded: Expanded | null;
  onToggle: (next: Expanded | null) => void;
  span: number;
}): React.ReactElement {
  const open = expanded?.rowKey === row.key ? row.cells.find((c) => c.channel === expanded.channel) : undefined;
  return (
    <>
      <tr data-testid={`health-row-${row.key}`}>
        <Box component="td" sx={{ fontWeight: depth === 0 ? 500 : 400, color: depth === 0 ? 'text.primary' : 'text.secondary', pl: depth === 0 ? 1.5 : 3.5 }}>
          {depth > 0 ? `↳ ${KIND_LABEL[row.group]} ${row.name}` : row.name}
        </Box>
        {row.cells.map((cell) => (
          <td key={cell.channel}>
            <CellButton cell={cell} rowKey={row.key} selected={open?.channel === cell.channel} onToggle={onToggle} />
          </td>
        ))}
      </tr>
      {open !== undefined && (
        <tr data-testid="health-detail-row">
          <Box component="td" colSpan={span} sx={(theme) => ({ bgcolor: theme.ogs.surfaces.input, px: 2, py: 1.5 })}>
            <CellDetail row={row} cell={open} />
          </Box>
        </tr>
      )}
    </>
  );
}

function CellButton({ cell, rowKey, selected, onToggle }: { cell: MatrixCell; rowKey: string; selected: boolean; onToggle: (next: Expanded | null) => void }): React.ReactElement {
  if (cell.severity === null) {
    return (
      <Box component="span" data-testid={`health-cell-${rowKey}-${cell.channel}`} aria-label="Nada verificado" sx={{ color: 'text.disabled' }}>
        —
      </Box>
    );
  }
  const severity = cell.severity;
  return (
    <Box
      component="button"
      type="button"
      data-testid={`health-cell-${rowKey}-${cell.channel}`}
      data-severity={severity}
      aria-expanded={selected}
      onClick={() => onToggle(selected ? null : { rowKey, channel: cell.channel })}
      sx={(theme) => ({
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.75,
        mx: -0.75,
        py: 0.25,
        borderRadius: `${theme.ogs.radius.xs}px`,
        fontWeight: severity === 'ok' ? 400 : 600,
        color: severity === 'ok' ? 'text.secondary' : severity === 'warning' ? theme.palette.warning.dark : 'error.main',
        outline: selected ? `1.5px solid ${theme.palette.info.main}` : 'none',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: `1.5px solid ${theme.palette.info.main}` },
      })}
    >
      <StateDot severity={severity} />
      {STATE_LABEL[severity]}
    </Box>
  );
}

function Mono({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Typography component="div" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.6875rem', color: 'text.secondary', wordBreak: 'break-all' })}>
      {children}
    </Typography>
  );
}

/** What happened in one channel for one customization, when it was checked, and the one action for the cause. */
function CellDetail({ row, cell }: { row: MatrixRow; cell: MatrixCell }): React.ReactElement {
  const severity = cell.severity ?? 'ok';
  const problems = cell.checks.filter((c) => c.severity !== 'ok');
  const shown = problems.length > 0 ? problems : cell.checks;
  const checkedAt = cell.checks[0]?.observedAt;
  const channelName = CHANNELS[cell.channel].displayName;
  const coveredBy = cell.checks.find((c) => c.coveredBy !== undefined)?.coveredBy;

  return (
    <Box data-testid="health-detail">
      <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <StateDot severity={severity} />
        {`${STATE_LABEL[severity]} — ${KIND_LABEL[row.group]} ${row.name} no ${channelName}`}
      </Typography>
      {coveredBy !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {`O ${channelName} usa o arquivo do ${CHANNELS[coveredBy].displayName}; este é o estado dele.`}
        </Typography>
      )}
      {shown.length === 0 && severity !== 'ok' && (
        <Typography variant="body2" sx={{ mt: 0.75 }}>
          O problema está nos servidores deste plugin, listados abaixo.
        </Typography>
      )}
      {shown.map((check) => (
        <Box key={check.id} sx={{ mt: 1 }}>
          <Typography variant="body2">{check.severity === 'ok' ? okText(check) : causeText(check)}</Typography>
          {check.target !== undefined && <Mono>{check.target}</Mono>}
          {check.expected !== undefined && <Mono>{`deveria apontar para ${check.expected}`}</Mono>}
          {check.detail !== undefined && <Mono>{check.detail}</Mono>}
          {causeHint(check) !== undefined && (
            <Typography variant="caption" sx={{ display: 'block', color: 'info.main', mt: 0.25 }}>
              {causeHint(check)}
            </Typography>
          )}
        </Box>
      ))}
      {checkedAt !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {`Verificado às ${timeFormat.format(new Date(checkedAt))}`}
        </Typography>
      )}
      {problems[0] !== undefined && <DetailAction row={row} check={problems[0]} />}
    </Box>
  );
}

function okText(check: HealthCheck): string {
  if (check.category === 'symlink') return 'Instalado por link simbólico.';
  if (check.category === 'generated-file') return 'Arquivo gerado pelo app, sem alterações.';
  if (check.category === 'merge-entry') return 'Entrada escrita pelo app, sem alterações.';
  if (check.category === 'mcp-runtime') return 'Servidor funcionando.';
  return 'Sem problemas.';
}

/** The single button that fixes a cause from here, or nothing when no button can. */
function DetailAction({ row, check }: { row: MatrixRow; check: HealthCheck }): React.ReactElement | null {
  const qc = useQueryClient();
  const refresh = useRefreshDiagnostics();
  const install = useInstallEntity();
  const undo = useUndoInstall();
  const { data: servers } = useMcpList();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const fail = (err: unknown): void => setToast({ variant: 'error', message: err instanceof IpcCallError ? err.message : String(err) });
  // A covered channel reads the covering one's file: fixing it means syncing that channel.
  const channel = check.coveredBy ?? check.channel;
  const syncChannel = useMutation({
    mutationFn: (adapterId: ChannelId) => callIpc('adapter.syncAll', { adapterId }),
    onSettled: () => qc.invalidateQueries(),
  });

  let button: { label: string; pending: boolean; run: () => void } | null = null;
  switch (check.cause) {
    case 'missing':
    case 'repointed':
    case 'drifted':
      if (channel !== undefined) {
        button = {
          label: `Sincronizar ${CHANNELS[channel].displayName}`,
          pending: syncChannel.isPending,
          run: () => syncChannel.mutate(channel, { onError: fail }),
        };
      }
      break;
    case 'unmanaged':
      if (channel !== undefined && check.category !== 'merge-entry') {
        button = {
          label: 'Instalar por cima',
          pending: install.isPending,
          run: () =>
            install.mutate(
              { urn: row.urn, channels: [channel] },
              {
                onSuccess: (tokens) =>
                  setToast({
                    variant: 'success',
                    message: `"${row.name}" instalado no ${CHANNELS[channel].displayName}`,
                    ...(tokens.length > 0 ? { action: { label: 'Desfazer', onClick: () => undo.mutate(tokens, { onError: fail }) } } : {}),
                  }),
                onError: fail,
              },
            ),
        };
      }
      break;
    case 'needs-auth':
    case 'runtime-failed': {
      const server = (servers ?? []).find((s) => s.name === check.target || s.name === row.name);
      if (server !== undefined) {
        button = { label: check.cause === 'needs-auth' ? 'Entrar' : 'Abrir MCP', pending: false, run: () => openMcpPage(server) };
      }
      break;
    }
    case 'collector-failed':
      button = { label: 'Atualizar', pending: refresh.isPending, run: () => refresh.mutate() };
      break;
    default:
      break;
  }

  return (
    <>
      {button !== null && (
        <Box sx={{ mt: 1.25 }}>
          <Button variant="contained" size="small" disableElevation data-testid="health-detail-action" disabled={button.pending} onClick={button.run}>
            {button.label}
          </Button>
        </Box>
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function RefreshSummary({ result }: { result: RefreshResult }): React.ReactElement {
  const conflicts = result.sync.filter((r) => r.status === 'conflict').length;
  const errors = result.sync.filter((r) => r.status === 'error').length;
  const severity: Severity = errors > 0 ? 'error' : conflicts > 0 ? 'warning' : 'ok';
  const parts = [
    errors > 0 ? `${errors} ${errors === 1 ? 'falha' : 'falhas'} ao sincronizar` : `Sincronizado às ${timeFormat.format(new Date())}`,
    ...(conflicts > 0 ? [`${conflicts} ${conflicts === 1 ? 'arquivo substituído' : 'arquivos substituídos'} com backup`] : []),
    ...(result.importable > 0 ? [`${result.importable} ${result.importable === 1 ? 'item detectado' : 'itens detectados'} nos canais para importar`] : []),
  ];
  return (
    <Box
      data-testid="health-sync-summary"
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', px: 1.5, py: 1, mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
    >
      <StateDot severity={severity} />
      <Typography variant="body2" color="text.secondary">
        {parts.join(' · ')}
      </Typography>
    </Box>
  );
}
