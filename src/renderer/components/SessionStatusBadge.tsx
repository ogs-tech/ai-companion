import { Stack, Typography } from '@mui/material';
import { useSessionStatus } from '../hooks/use-sessions.js';
import { sessionAnchorKey, type SessionAnchor } from '../../shared/session.js';
import { FILTER_LABELS } from '../lib/session-attention.js';
import { SessionStateMark } from './SessionStateMark.js';

interface SessionStatusBadgeProps {
  anchor: SessionAnchor;
}

/** The anchor's most urgent session state — same mark and label as the tab and the Sessões list; renders nothing when the anchor has never had a session. */
export function SessionStatusBadge({ anchor }: SessionStatusBadgeProps): React.ReactElement | null {
  const state = useSessionStatus(anchor);
  if (!state) return null;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      data-testid={`session-status-${sessionAnchorKey(anchor)}`}
      data-state={state}
      sx={{ alignItems: 'center', flex: 'none', opacity: state === 'exited' ? 0.6 : 1 }}
    >
      <SessionStateMark state={state} />
      <Typography variant="caption" color="text.secondary" noWrap>
        {FILTER_LABELS[state]}
      </Typography>
    </Stack>
  );
}
