import { Box } from '@mui/material';
import { channelNames } from '../../lib/entity-health.js';
import { openDiagnosticsFor } from '../../lib/diagnostics-focus.js';
import { CHANNELS, type ChannelId } from '../../../shared/channel.js';

/** The small filled dot that, with its words, marks an error — colour is never the only carrier. */
export function ErrorDot(): React.ReactElement {
  return <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 }} />;
}

/** `Erro no Cursor`, or `Erro em 2 canais` when several (the tooltip names them). */
export function channelErrorLabel(channels: readonly ChannelId[]): string {
  const [only] = channels;
  return channels.length === 1 && only !== undefined ? `Erro no ${CHANNELS[only].displayName}` : `Erro em ${channels.length} canais`;
}

interface ChannelWarningProps {
  /** The item the warning belongs to; the click opens Diagnósticos on it. */
  urn: string;
  /** Urns whose problems roll up into this row (a plugin's servers and hooks); Diagnósticos shows theirs too. */
  relatedUrns?: readonly string[];
  channels: readonly ChannelId[];
}

/**
 * `● Erro no Cursor` — the only error a tree row ever shows. Silence means ok. The dot and the words always travel
 * together, so colour is never the only carrier of meaning.
 */
export function ChannelWarning({ urn, relatedUrns = [], channels }: ChannelWarningProps): React.ReactElement | null {
  if (channels.length === 0) return null;
  const names = channelNames(channels);
  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      data-testid="channel-warning"
      aria-label={`Problema em ${names}. Abrir diagnóstico`}
      title={`Problema em ${names} — abrir diagnóstico`}
      onClick={(e) => {
        e.stopPropagation();
        openDiagnosticsFor(urn, relatedUrns);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        openDiagnosticsFor(urn, relatedUrns);
      }}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.625,
        flexShrink: 0,
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        color: theme.palette.error.main,
        '&:hover': { textDecoration: 'underline' },
        '&:focus-visible': { outline: `1px solid ${theme.palette.error.main}`, borderRadius: `${theme.ogs.radius.xs}px` },
      })}
    >
      <ErrorDot />
      {channelErrorLabel(channels)}
    </Box>
  );
}

interface ProblemCountProps {
  count: number;
}

/** `● N` on a group: how many items inside have a problem. Absent at zero. */
export function ProblemCount({ count }: ProblemCountProps): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <Box
      component="span"
      data-testid="problem-count"
      aria-label={`${count} ${count === 1 ? 'item com problema' : 'itens com problema'}`}
      sx={(theme) => ({ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.75rem', color: theme.palette.error.main, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' })}
    >
      <ErrorDot />
      {count}
    </Box>
  );
}
