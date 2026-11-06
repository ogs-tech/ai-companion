import { Box, Tooltip } from '@mui/material';
import { useSessionsUsing } from '../../hooks/use-sessions.js';
import { FILTER_GLYPHS, FILTER_LABELS, rowStateOf } from '../../lib/session-attention.js';
import type { SessionUsage } from '../../../shared/session.js';

/** "2 sessões" beside a skill / agent / MCP that running sessions used in the last 10 minutes; the tooltip lists them with their state. Nothing when none did. */
export function SessionsUsingBadge({ usage, testId }: { usage: SessionUsage; testId: string }): React.ReactElement | null {
  const using = useSessionsUsing(usage);
  if (using.length === 0) return null;
  const list = using
    .map((s) => {
      const state = rowStateOf({ status: 'running', activity: s.activity } as Parameters<typeof rowStateOf>[0]);
      return `${FILTER_GLYPHS[state]} ${s.label} — ${FILTER_LABELS[state]}`;
    })
    .join('\n');
  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{list}</Box>}>
      <Box
        component="span"
        data-testid={testId}
        sx={{ flexShrink: 0, fontSize: '0.6875rem', color: 'success.main', whiteSpace: 'nowrap' }}
      >
        {using.length === 1 ? '1 sessão' : `${using.length} sessões`}
      </Box>
    </Tooltip>
  );
}
