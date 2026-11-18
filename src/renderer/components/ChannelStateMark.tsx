import { Box } from '@mui/material';
import type { ChannelId } from '../../shared/channel.js';
import type { SessionRowState } from '../lib/session-attention.js';
import { ChannelMark } from './ChannelMark.js';
import { SessionStateMark } from './SessionStateMark.js';

interface ChannelBadgeMarkProps {
  channel: ChannelId;
  /** The channel mark's square size in px; the badge slot scales from it. */
  size?: number;
  /** Draws the badge with a dashed ring (a state inferred rather than measured). */
  dashed?: boolean;
  /** The badge itself, drawn `badgeSize(size)` px square. */
  children: React.ReactNode;
}

/** The badge's square size for a mark of `size` px. */
export function badgeSize(size: number): number {
  return Math.round(size * 0.7);
}

/**
 * A channel mark with a badge in its bottom-right corner: one glyph that says both where (the channel) and what (the
 * badge). Session tabs and rows badge it with the session state; Customizações rows with the item's state there.
 */
export function ChannelBadgeMark({ channel, size = 16, dashed = false, children }: ChannelBadgeMarkProps): React.ReactElement {
  const badge = badgeSize(size);
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
          ...(dashed ? { border: '1px dashed currentColor', p: 0 } : {}),
          // Cuts the badge out of whatever the mark sits on, so it reads on any tab or row background.
          bgcolor: theme.palette.background.paper,
        })}
      >
        {children}
      </Box>
    </Box>
  );
}

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
  return (
    <ChannelBadgeMark channel={channel} size={size} dashed={estimated}>
      <SessionStateMark state={state} size={badgeSize(size)} breathing={breathing} {...(testId ? { testId } : {})} />
    </ChannelBadgeMark>
  );
}
