import { Box, keyframes } from '@mui/material';
import { FILTER_LABELS, type SessionRowState } from '../lib/session-attention.js';

const COLORS: Record<SessionRowState, string> = {
  'needs-input': 'warning.main',
  working: 'success.main',
  idle: 'text.secondary',
  exited: 'text.secondary',
};

const spin = keyframes`to { transform: rotate(360deg); }`;
const pulse = keyframes`50% { opacity: 0.35; }`;
const breathe = keyframes`0%, 100% { opacity: 0.35; } 50% { opacity: 1; }`;
const pop = keyframes`from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; }`;

/** 8 dashes around a r=3.75 circle (circumference ≈ 23.56): legible at 12px, where finer dots collapse into a speck. */
const IDLE_DASH = '1.47 1.47';

/**
 * The state's shape, drawn (not typeset) so every state shares one box and one
 * stroke weight — font glyphs rendered at different optical sizes (a tiny ◌
 * next to a large ○). Colour comes from the parent (`currentColor`).
 */
export function StateGlyph({ state, size = 12 }: { state: SessionRowState; size?: number }): React.ReactElement {
  const stroke = { stroke: 'currentColor', fill: 'none', strokeLinecap: 'round' } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden focusable="false" style={{ display: 'block', flex: 'none' }}>
      {state === 'needs-input' && <path d="M6 1.5v5.2M6 9.2v1.3" {...stroke} strokeWidth={1.8} />}
      {state === 'working' && <path d="M6 1v10M1.7 3.5l8.6 5M1.7 8.5l8.6-5" {...stroke} strokeWidth={1.5} />}
      {state === 'idle' && <circle cx="6" cy="6" r="3.75" {...stroke} strokeWidth={1.5} strokeDasharray={IDLE_DASH} strokeLinecap="butt" />}
      {state === 'exited' && (
        <>
          <circle cx="6" cy="6" r="3.75" {...stroke} strokeWidth={1.5} />
          <path d="M3.4 8.6l5.2-5.2" {...stroke} strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

interface SessionStateMarkProps {
  state: SessionRowState;
  testId?: string;
  size?: number;
  /** A session with no signal yet: the mark slowly breathes instead of sitting still. */
  breathing?: boolean;
}

/** The one four-state indicator (! ✻ ◌ ⊘): shape carries the state, colour only reinforces; motion honours reduced-motion. */
export function SessionStateMark({ state, testId, size = 12, breathing = false }: SessionStateMarkProps): React.ReactElement {
  return (
    <Box
      component="span"
      role="img"
      aria-label={FILTER_LABELS[state]}
      data-state={state}
      {...(testId ? { 'data-testid': testId } : {})}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flex: 'none',
        color: COLORS[state],
        transition: 'color 0.2s ease',
        '@media (prefers-reduced-motion: no-preference)': {
          // Keyed by state so a change remounts the glyph and replays the pop.
          '& > svg': { animation: `${pop} 0.18s ease-out` },
          ...(state === 'working' ? { animation: `${spin} 2.4s linear infinite` } : {}),
          ...(state === 'needs-input' ? { animation: `${pulse} 1.2s ease-in-out infinite` } : {}),
          ...(breathing && state === 'idle' ? { animation: `${breathe} 1.6s ease-in-out infinite` } : {}),
        },
      }}
    >
      <StateGlyph key={state} state={state} size={size} />
    </Box>
  );
}
