import {
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { Icon } from '../../components/ds/Icon.js';
import { Kicker } from '../../components/ds/Kicker.js';
import { ScreenHeader } from '../../components/ds/ScreenHeader.js';
import { StatusPill } from '../../components/ds/StatusPill.js';
import { clearDiagnosticsFocus, useDiagnosticsFocus } from '../../lib/diagnostics-focus.js';
import { useHealthReport } from '../../hooks/use-health-report.js';
import { useSyncThenRefresh } from '../../hooks/use-sync-then-refresh.js';
import type { HealthCategory, HealthCheck, Severity } from '../../../shared/health.js';
import type { SyncResult } from '../../../shared/sync-result.js';

const CATEGORY_LABEL: Record<HealthCategory, string> = {
  'mcp-auth': 'MCP Authentication',
  'mcp-runtime': 'MCP Runtime',
  'config-drift': 'Config Drift',
  symlink: 'Symlinks',
  'generated-file': 'Generated Files',
  'merge-entry': 'Hooks & MCP entries',
};

const SEVERITY_PILL: Record<Severity, 'ok' | 'warning' | 'error'> = {
  ok: 'ok',
  warning: 'warning',
  error: 'error',
};

const CATEGORY_ORDER: readonly HealthCategory[] = [
  'mcp-auth',
  'mcp-runtime',
  'config-drift',
  'symlink',
  'generated-file',
  'merge-entry',
];

function groupByCategory(checks: HealthCheck[]): Map<HealthCategory, HealthCheck[]> {
  const groups = new Map<HealthCategory, HealthCheck[]>();
  for (const category of CATEGORY_ORDER) {
    const items = checks.filter((c) => c.category === category);
    if (items.length > 0) groups.set(category, items);
  }
  return groups;
}

export function HealthScreen(): React.ReactElement {
  const { data, isLoading, isFetching } = useHealthReport('personal');
  const sync = useSyncThenRefresh('personal');

  // Arriving from a ⚠ in the customizations tree narrows the screen to that item's checks.
  const focusUrn = useDiagnosticsFocus();
  const allChecks = data?.checks ?? [];
  const checks = focusUrn === null ? allChecks : allChecks.filter((c) => c.entityUrn === focusUrn);
  const actionable = checks.filter((c) => c.severity !== 'ok');
  const groups = groupByCategory(checks);

  return (
    <Container component="main" data-testid="health-screen" maxWidth="lg" sx={{ py: 2.5 }}>
      <ScreenHeader
        kicker="Diagnóstico"
        title="Diagnóstico"
        subtitle={
          data
            ? `${data.counts.error} error(s), ${data.counts.warning} warning(s), ${data.counts.ok} ok`
            : undefined
        }
        actions={
          <Button
            variant="outlined"
            size="small"
            startIcon={<Icon glyph={RefreshCw} size={16} />}
            data-testid="health-refresh"
            disabled={isFetching || sync.isPending}
            onClick={() => sync.mutate()}
          >
            Atualizar
          </Button>
        }
      />

      {focusUrn !== null && (
        <Box data-testid="health-focus" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Mostrando apenas <Box component="span" sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono })}>{focusUrn}</Box>
          </Typography>
          <Button size="small" data-testid="health-focus-clear" onClick={clearDiagnosticsFocus}>
            Ver tudo
          </Button>
        </Box>
      )}

      {sync.data && <SyncSummary results={sync.data} />}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!isLoading && actionable.length === 0 && (
        <Box
          data-testid="health-all-clear"
          sx={{
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 1,
            p: 4,
            textAlign: 'center',
            color: 'text.secondary',
          }}
        >
          <Box component="span" sx={{ color: 'success.main', display: 'inline-flex', mb: 1 }}>
            <Icon glyph={CheckCircle2} size={40} />
          </Box>
          <Typography variant="body1">Tudo certo por aqui.</Typography>
        </Box>
      )}

      {!isLoading &&
        actionable.length > 0 &&
        [...groups.entries()].map(([category, items]) => (
          <Box key={category} data-testid={`health-category-${category}`} sx={{ mb: 3 }}>
            <Box sx={{ mb: 1 }}>
              <Kicker>{CATEGORY_LABEL[category]}</Kicker>
            </Box>
            <Stack
              divider={<Divider />}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              {items.map((check) => (
                <Box
                  key={check.id}
                  data-testid={`health-check-${check.id}`}
                  sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
                >
                  <StatusPill variant={SEVERITY_PILL[check.severity]} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{check.title}</Typography>
                    {check.detail && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {check.detail}
                      </Typography>
                    )}
                    {check.remediation && (
                      <Typography variant="caption" color="primary" sx={{ display: 'block' }}>
                        {check.remediation}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Stack>
          </Box>
        ))}
    </Container>
  );
}

function SyncSummary({ results }: { results: SyncResult[] }): React.ReactElement {
  const okCount = results.filter((r) => r.status === 'ok').length;
  const conflicts = results.filter((r) => r.status === 'conflict').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const clean = conflicts === 0 && errors === 0;
  return (
    <Box
      data-testid="health-sync-summary"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        mb: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
      }}
    >
      <Box
        component="span"
        sx={{ color: clean ? 'success.main' : 'text.secondary', display: 'inline-flex' }}
      >
        <Icon glyph={clean ? CheckCircle2 : RefreshCw} size={16} />
      </Box>
      <Typography
        component="span"
        sx={(theme) => ({
          fontFamily: theme.ogs.fonts.mono,
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'text.secondary',
          whiteSpace: 'nowrap',
        })}
      >
        Sincronização
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
        <StatusPill variant="ok" label={`${okCount} ok`} />
        {conflicts > 0 && (
          <Tooltip title="Conflitos resolvidos com backup do alvo anterior">
            <span>
              <StatusPill
                variant="warning"
                label={`${conflicts} conflict${conflicts === 1 ? '' : 's'}`}
              />
            </span>
          </Tooltip>
        )}
        {errors > 0 && (
          <StatusPill variant="error" label={`${errors} error${errors === 1 ? '' : 's'}`} />
        )}
      </Stack>
    </Box>
  );
}
