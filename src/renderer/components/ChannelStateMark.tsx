import { Box } from '@mui/material';
import type { ChannelId } from '../../shared/channel.js';
import type { SessionRowState } from '../lib/session-attention.js';
import { ChannelMark } from './ChannelMark.js';
import { SessionStateMark } from './SessionStateMark.js';

interface ChannelStateMarkProps {
  channel: ChannelId;
  state: SessionRowState;
  testId?: string;
  /** The channel mark's square size in px; the state badge scales from it. */
  size?: number;
  /** A session with no signal yet: the badge slowly breathes. */
  breathing?: boolean;
  /** State inferred rather than measured: the badge gets a dashed ring. */
  estimated?: boolean;
}

/**
 * One icon for a session: the channel it runs on, with its state as a badge in the corner. Replaces the channel
 * mark and the state mark sitting side by side, so a tab or row carries a single glyph. The badge keeps the
 * shared four-state shapes (and the spin on working), so shape still carries the state.
 */
export function ChannelStateMark({ channel, state, testId, size = 16, breathing = false, estimated = false }: ChannelStateMarkProps): React.ReactElement {
  const badge = Math.round(size * 0.7);
  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: size, height: size, flex: 'none' }}>
      <ChannelMark harness={channel} size={size} />
      <Box
        component="span"
        sx={(theme) => ({
          position: 'absolute',
          right: -badge * 0.4,
          bottom: -badge * 0.4,
          display: 'inline-flex',
          p: '1px',
          borderRadius: '50%',
          ...(estimated ? { border: '1px dashed currentColor', p: 0 } : {}),
          // Cuts the badge out of whatever the mark sits on, so it reads on any tab or row background.
          bgcolor: theme.palette.background.paper,
        })}
      >
        <SessionStateMark state={state} size={badge} breathing={breathing} {...(testId ? { testId } : {})} />
      </Box>
    </Box>
  );
}
