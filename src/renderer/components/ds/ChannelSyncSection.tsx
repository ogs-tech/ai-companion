import { Box, Button, Stack, Typography } from '@mui/material';
import { CHANNELS, type ChannelId } from '../../../shared/channel.js';
import { useHealthReport } from '../../hooks/use-health-report.js';
import { useSettings } from '../../hooks/use-settings.js';
import { channelSyncRows, type SyncRow } from '../../lib/channel-sync.js';
import { openDiagnosticsFor } from '../../lib/diagnostics-focus.js';

const QUIET: Record<Exclude<SyncRow['status'], 'ok' | 'problem'>, string> = {
  off: 'Desativado',
  'run-only': 'Só roda sessões',
  unchecked: 'Ainda não sincronizado',
};

const NO_ADAPTERS: Readonly<Record<ChannelId, { enabled: boolean }>> = {
  claude: { enabled: false },
  cursor: { enabled: false },
  lmstudio: { enabled: false },
};

/** `●` in sync (green), `▲` a problem (amber), `—` nothing to say (slate). The glyph always travels with the words. */
function Glyph({ status }: { status: SyncRow['status'] }): React.ReactElement {
  const glyph = status === 'ok' ? '●' : status === 'problem' ? '▲' : '—';
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        width: 12,
        flexShrink: 0,
        fontSize: '0.6875rem',
        color: status === 'ok' ? theme.palette.success.main : status === 'problem' ? theme.palette.warning.main : theme.palette.text.disabled,
      })}
    >
      {glyph}
    </Box>
  );
}

interface ChannelSyncSectionProps {
  urn: string;
  /** False for an item turned off: it goes to no channel at all. */
  entityEnabled?: boolean;
}

/**
 * "Sincronização": for each channel, where this item lands and whether it is in sync there, with "Abrir
 * diagnóstico" on a problem. Silent while the health report loads or fails — no row may claim a state it has not read.
 */
export function ChannelSyncSection({ urn, entityEnabled = true }: ChannelSyncSectionProps): React.ReactElement | null {
  const report = useHealthReport('personal');
  const settings = useSettings();
  if (!Array.isArray(report.data?.checks) || report.isError) return null;
  const view = channelSyncRows({ urn, checks: report.data.checks, adapters: settings.data?.adapters ?? NO_ADAPTERS, entityEnabled });

  return (
    <Box data-testid="channel-sync" sx={{ mt: 2 }}>
      <Typography variant="overline" component="h3" sx={{ display: 'block', color: 'text.secondary', lineHeight: 2 }}>
        Sincronização
      </Typography>
      {view.kind === 'entity-disabled' ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
          <Glyph status="off" />
          <Typography variant="body2" color="text.secondary">
            Desativado — não vai para nenhum canal
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={0.75}>
          {view.rows.map((row) => (
            <Stack key={row.channel} direction="row" spacing={0.75} data-testid={`channel-sync-${row.channel}`} sx={{ alignItems: 'baseline' }}>
              <Glyph status={row.status} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {CHANNELS[row.channel].displayName}
                  </Typography>
                  {!('lines' in row) && (
                    <Typography variant="body2" color="text.secondary">
                      {QUIET[row.status as keyof typeof QUIET]}
                    </Typography>
                  )}
                </Stack>
                {'lines' in row &&
                  row.lines.map((line, i) => (
                    <Box key={i} sx={{ minWidth: 0 }}>
                      {line.path !== undefined && (
                        <Typography
                          component="div"
                          title={line.path}
                          sx={(theme) => ({ fontFamily: theme.ogs.fonts.mono, fontSize: '0.75rem', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}
                        >
                          {line.path}
                        </Typography>
                      )}
                      <Typography variant="caption" component="div" color={row.status === 'problem' ? 'text.primary' : 'text.secondary'}>
                        {line.text}
                      </Typography>
                      {line.remediation !== undefined && (
                        <Typography variant="caption" component="div" color="text.secondary">
                          {line.remediation}
                        </Typography>
                      )}
                    </Box>
                  ))}
                {row.status === 'problem' && (
                  <Button
                    size="small"
                    data-testid={`channel-sync-open-${row.channel}`}
                    onClick={() => openDiagnosticsFor(urn)}
                    sx={{ mt: 0.25, px: 0.5, minWidth: 0, textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    Abrir diagnóstico
                  </Button>
                )}
              </Box>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
