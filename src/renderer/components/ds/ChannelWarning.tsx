import { Box } from '@mui/material';
import { channelNames } from '../../lib/entity-health.js';
import { openDiagnosticsFor } from '../../lib/diagnostics-focus.js';
import type { ChannelId } from '../../../shared/channel.js';

interface ChannelWarningProps {
  /** The item the warning belongs to; the click opens Diagnósticos on it. */
  urn: string;
  channels: readonly ChannelId[];
}

/**
 * `⚠ Cursor` / `⚠ Claude · Cursor` — the only status a tree row ever shows. Silence means ok. The glyph and the
 * channel name always travel together, so colour is never the only carrier of meaning.
 */
export function ChannelWarning({ urn, channels }: ChannelWarningProps): React.ReactElement | null {
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
        openDiagnosticsFor(urn);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        openDiagnosticsFor(urn);
      }}
      sx={(theme) => ({
        flexShrink: 0,
        fontSize: '0.6875rem',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        color: theme.palette.warning.main,
        '&:focus-visible': { outline: `1px solid ${theme.palette.warning.main}`, borderRadius: `${theme.ogs.radius.xs}px` },
      })}
    >
      ⚠ {names}
    </Box>
  );
}

interface ProblemCountProps {
  count: number;
}

/** `N ⚠` on a folder: how many items inside have a problem. Absent at zero. */
export function ProblemCount({ count }: ProblemCountProps): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <Box
      component="span"
      data-testid="problem-count"
      aria-label={`${count} ${count === 1 ? 'item com problema' : 'itens com problema'}`}
      sx={(theme) => ({ fontSize: '0.6875rem', color: theme.palette.warning.main, whiteSpace: 'nowrap' })}
    >
      {count} ⚠
    </Box>
  );
}
