import { useState } from 'react';
import { Box, Button, Popover, Typography } from '@mui/material';
import { CHANNELS } from '../../../shared/channel.js';
import type { Severity } from '../../../shared/health.js';
import { useAreaNavigation } from '../../hooks/use-area-navigation.js';
import { useHealthReport } from '../../hooks/use-health-report.js';
import { useRefreshDiagnostics } from '../../hooks/use-refresh-diagnostics.js';
import { useSettings } from '../../hooks/use-settings.js';
import { countsLabel, STATE_LABEL } from '../../lib/diagnostics-copy.js';
import { clearDiagnosticsFocus, openDiagnosticsFor } from '../../lib/diagnostics-focus.js';
import { buildDiagnosticsMatrix, KIND_LABEL, type MatrixRow } from '../../lib/diagnostics-matrix.js';
import { SEVERITY_COLOR, StateDot } from '../ds/StateDot.js';

const SHOWN = 5;

/** "Com erro no Claude Code", naming every channel in the row's worst state. */
function whereLabel(row: MatrixRow): string {
  const channels = row.cells.filter((c) => c.severity === row.severity).map((c) => CHANNELS[c.channel].displayName);
  return `${STATE_LABEL[row.severity]} no ${channels.join(' e ')}`;
}

/**
 * The status bar's diagnostics entry: the worst state in words ("1 com erro", "2 em alerta", "Conectado"). A click
 * opens a summary of what has a problem — each line deep-links into Diagnóstico — with Atualizar and Abrir
 * diagnóstico. Silent until the report has loaded.
 */
export function DiagnosticsStatus(): React.ReactElement | null {
  const { data: report } = useHealthReport('personal');
  const { data: settings } = useSettings();
  const navigate = useAreaNavigation();
  const refresh = useRefreshDiagnostics();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const close = (): void => setAnchor(null);
  if (!Array.isArray(report?.checks)) return null;

  const matrix = buildDiagnosticsMatrix({ checks: report.checks, adapters: settings?.adapters ?? {} });
  const severity: Severity = matrix.counts.error > 0 ? 'error' : matrix.counts.warning > 0 ? 'warning' : 'ok';
  const label = severity === 'error' ? `${matrix.counts.error} com erro` : severity === 'warning' ? `${matrix.counts.warning} em alerta` : 'Conectado';
  const hidden = matrix.problems.length - SHOWN;

  const toggle = (el: HTMLElement): void => setAnchor((current) => (current === null ? el : null));
  return (
    <>
      <Box
        data-testid="status-pill-sync"
        data-variant={severity}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Diagnóstico: ${label}`}
        onClick={(e) => toggle(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggle(e.currentTarget);
        }}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.625,
          cursor: 'pointer',
          fontWeight: severity === 'ok' ? 400 : 600,
          color: severity === 'ok' ? 'text.secondary' : SEVERITY_COLOR[severity],
          '&:hover': { color: severity === 'ok' ? 'text.primary' : undefined, textDecoration: severity === 'ok' ? undefined : 'underline' },
        }}
      >
        <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: SEVERITY_COLOR[severity] }} />
        {label}
      </Box>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{ paper: { 'data-testid': 'diagnostics-popover', sx: { width: 320, mt: -0.75 } } as object }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, px: 1.5, pt: 1.25, pb: 0.5 }}>
          {countsLabel(matrix.counts)}
        </Typography>
        {matrix.problems.slice(0, SHOWN).map((row) => (
          <Box
            key={row.key}
            component="button"
            type="button"
            data-testid={`diagnostics-popover-item-${row.urn}`}
            onClick={() => {
              close();
              openDiagnosticsFor(row.urn, row.children.map((c) => c.urn));
            }}
            sx={{
              all: 'unset',
              boxSizing: 'border-box',
              width: '100%',
              cursor: 'pointer',
              display: 'flex',
              gap: 1,
              alignItems: 'baseline',
              px: 1.5,
              py: 0.625,
              fontSize: '0.75rem',
              '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
            }}
          >
            <StateDot severity={row.severity} />
            <span>
              <b>{row.name}</b>
              {` · ${KIND_LABEL[row.group]} — `}
              <Box component="span" sx={{ color: SEVERITY_COLOR[row.severity], fontWeight: 600 }}>
                {whereLabel(row)}
              </Box>
            </span>
          </Box>
        ))}
        {hidden > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
            {`e mais ${hidden}`}
          </Typography>
        )}
        {matrix.general.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
            {matrix.general.length === 1 ? '1 verificação não pôde rodar' : `${matrix.general.length} verificações não puderam rodar`}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 1.5, py: 1, mt: 0.5, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" variant="outlined" data-testid="diagnostics-popover-refresh" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? 'Atualizando…' : 'Atualizar'}
          </Button>
          {severity !== 'ok' && (
            <Button
              size="small"
              variant="contained"
              disableElevation
              data-testid="diagnostics-popover-open"
              onClick={() => {
                close();
                clearDiagnosticsFocus();
                navigate('diagnostico');
              }}
            >
              Abrir diagnóstico
            </Button>
          )}
        </Box>
      </Popover>
    </>
  );
}
