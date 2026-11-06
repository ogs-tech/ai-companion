import { Box } from '@mui/material';
import { FILTER_GLYPHS, FILTER_LABELS, type SessionRowState } from '../lib/session-attention.js';

const COLORS: Record<SessionRowState, string> = {
  'needs-input': 'warning.main',
  working: 'success.main',
  idle: 'text.secondary',
  exited: 'text.secondary',
};

/** The one four-state indicator (✻ ! ◌ ×): shape carries the state, colour only reinforces; motion honours reduced-motion. */
export function SessionStateMark({ state, testId }: { state: SessionRowState; testId?: string }): React.ReactElement {
  return (
    <Box
      component="span"
      role="img"
      aria-label={FILTER_LABELS[state]}
      data-state={state}
      {...(testId ? { 'data-testid': testId } : {})}
      sx={{
        display: 'inline-block',
        width: 12,
        textAlign: 'center',
        fontWeight: 700,
        fontSize: '0.75rem',
        lineHeight: 1,
        color: COLORS[state],
        '@media (prefers-reduced-motion: no-preference)':
          state === 'working'
            ? { animation: 'sessionMarkSpin 2.4s linear infinite', '@keyframes sessionMarkSpin': { to: { transform: 'rotate(360deg)' } } }
            : state === 'needs-input'
              ? { animation: 'sessionMarkPulse 1.2s infinite', '@keyframes sessionMarkPulse': { '50%': { opacity: 0.35 } } }
              : {},
      }}
    >
      {FILTER_GLYPHS[state]}
    </Box>
  );
}
