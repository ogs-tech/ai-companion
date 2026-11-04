import { Box, Skeleton, Stack, Tooltip, Typography, alpha, keyframes } from '@mui/material';
import type { HarnessId } from '../../../shared/harness.js';
import type { SessionAttention } from '../../../shared/session.js';
import {
  attentionLabel,
  FILTER_GLYPHS,
  formatIdleFor,
  formatWait,
  type SessionRowState,
} from '../../lib/session-attention.js';
import type { SessionHistoryEntry } from '../../../shared/session-history.js';
import {
  describeCostSource,
  formatCostUsd,
  formatDuration,
  formatModel,
  formatWhen,
} from '../../lib/format-session-history.js';

const pulse = keyframes`50% { opacity: 0.35; }`;
const shimmer = keyframes`50% { opacity: 0.45; }`;

export interface SessionRowProps {
  label: string;
  /** Which harness runs (or ran) the session — shown before the model. */
  harness: HarnessId;
  /** One of the four attention states; drives the indicator, the left bar and the dimming. */
  state: SessionRowState;
  /** Why a `needs-input` row is blocked. */
  attention?: SessionAttention | undefined;
  /** Epoch ms a `needs-input` row started waiting. */
  waitingSince?: number | null;
  /** Epoch ms an `idle` row stopped, for "há 3min". */
  idleSince?: number | null;
  /** Epoch ms "now", injected so waiting time ticks and tests stay deterministic. */
  now?: number;
  /** The transcript's reading of this conversation; absent while a just-spawned session has yet to write one. */
  history: SessionHistoryEntry | null;
  onOpen: () => void;
  /** Hover/focus actions (stop/delete), shown in place of the time on line two; stopPropagation'd from the row itself. */
  actions?: React.ReactNode;
  testId: string;
}

/**
 * One session in the Control Panel: two lines, because a single line cannot
 * hold a name, a cost, a model, a time and a duration without becoming a
 * `·`-joined run-on that nobody reads.
 *
 * Line one carries the two things being compared down the list — the name and
 * the cost — with the cost right-aligned in mono so the digits line up into a
 * scannable column. Line two carries the context: which model, and when, for
 * how long.
 *
 * A real `<button>` rather than a div: arrow keys move, Enter opens, and the
 * focus ring is visible, because this is the only way to reach a session once
 * its tab is closed.
 */
const ROW_NAMES: Record<SessionRowState, string> = {
  'needs-input': 'Precisa de você',
  working: 'Trabalhando',
  idle: 'Terminou',
  exited: 'Encerrada',
};

const INDICATOR_COLORS: Record<
  SessionRowState,
  'warning.main' | 'success.main' | 'info.main' | 'text.secondary'
> = {
  'needs-input': 'warning.main',
  working: 'success.main',
  idle: 'info.main',
  exited: 'text.secondary',
};

export function SessionRow({
  label,
  harness,
  state,
  attention,
  waitingSince = null,
  idleSince = null,
  now,
  history,
  onOpen,
  actions,
  testId,
}: SessionRowProps): React.ReactElement {
  const running = state !== 'exited';
  const needsInput = state === 'needs-input';
  const working = state === 'working';
  const dimmed = state === 'exited';
  const model =
    running && !history ? 'iniciando…' : history?.model ? formatModel(history.model) : null;
  const harnessText = [harness, model].filter(Boolean).join(' · ');
  const costLabel = history ? formatCostUsd(history.costUsd) : null;

  return (
    <Box
      component="button"
      type="button"
      data-testid={testId}
      onClick={onOpen}
      sx={(theme) => ({
        position: 'relative',
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 0,
        borderRadius: `${theme.ogs.radius.xs}px`,
        // The 3px bar (below) is only for the two states that want attention or
        // show activity; the indicator glyph and its accessible name carry
        // every state for everyone else. Blue lives on the glyph alone.
        borderLeft: '3px solid transparent',
        bgcolor: needsInput ? alpha(theme.palette.warning.main, 0.07) : 'transparent',
        '&::before':
          needsInput || working
            ? {
                content: '""',
                position: 'absolute',
                left: -3,
                top: 0,
                bottom: 0,
                width: 3,
                bgcolor: needsInput ? theme.palette.warning.main : theme.palette.success.main,
                '@media (prefers-reduced-motion: no-preference)': working
                  ? { animation: `${shimmer} 3s ease-in-out infinite` }
                  : {},
              }
            : undefined,
        opacity: dimmed ? 0.72 : 1,
        cursor: 'pointer',
        px: 1.25,
        py: 0.75,
        font: 'inherit',
        '&:hover': { bgcolor: theme.palette.action.hover },
        // Actions take the time's place on line two; cost on line one stays put.
        '&:hover .session-row-time, &:focus-visible .session-row-time, &:focus-within .session-row-time':
          { display: 'none' },
        '&:hover .session-row-actions, &:focus-visible .session-row-actions, &:focus-within .session-row-actions':
          { display: 'flex' },
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      })}
    >
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box
          component="span"
          role="img"
          aria-label={ROW_NAMES[state]}
          data-testid={`${testId}-indicator`}
          data-state={state}
          sx={{
            width: 14,
            flexShrink: 0,
            textAlign: 'center',
            fontWeight: 700,
            fontSize: '0.8125rem',
            lineHeight: '1.2rem',
            color: INDICATOR_COLORS[state],
            // Only "precisa de você" moves: if everything blinks, nothing is urgent.
            '@media (prefers-reduced-motion: no-preference)': needsInput
              ? { animation: `${pulse} 1.2s infinite` }
              : {},
          }}
        >
          {FILTER_GLYPHS[state]}
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, minWidth: 0 }}>
            <Typography
              component="span"
              noWrap
              sx={{ fontSize: '0.8125rem', flexGrow: 1, minWidth: 0, color: 'text.primary' }}
            >
              {label}
            </Typography>
            {costLabel === null ? (
              <Skeleton
                variant="text"
                width={34}
                sx={{ flexShrink: 0 }}
                data-testid={`${testId}-cost-pending`}
              />
            ) : (
              <Tooltip title={describeCostSource(history!.costSource, harness)}>
                <Typography
                  component="span"
                  data-testid={`${testId}-cost`}
                  sx={(theme) => ({
                    fontFamily: theme.ogs.fonts.mono,
                    fontSize: '0.6875rem',
                    flexShrink: 0,
                    color: 'text.primary',
                  })}
                >
                  {costLabel}
                </Typography>
              </Tooltip>
            )}
          </Stack>

          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 1, minWidth: 0, mt: 0.125, minHeight: 22 }}
          >
            {needsInput && (
              <Box
                component="span"
                data-testid={`${testId}-reason`}
                sx={(theme) => ({
                  flexShrink: 0,
                  maxWidth: '70%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  bgcolor: alpha(theme.palette.warning.main, 0.15),
                  color: 'warning.main',
                  borderRadius: '9px',
                  px: 0.875,
                  fontSize: '0.625rem',
                })}
              >
                {attentionLabel(attention)}
              </Box>
            )}
            {/*
          `text.secondary` at full opacity rather than the primary ink at 55%:
          on the rail's cream surface the latter measures 3.6:1 and fails
          WCAG AA, the token measures 5.1:1 and passes. At 10px that is
          legibility, not pedantry.
        */}
            <Typography
              component="span"
              noWrap
              sx={{ fontSize: '0.625rem', color: 'text.secondary', flexGrow: 1, minWidth: 0 }}
            >
              {harnessText}
            </Typography>
            <Typography
              component="span"
              noWrap
              className={actions ? 'session-row-time' : undefined}
              sx={(theme) => ({
                fontFamily: theme.ogs.fonts.mono,
                fontSize: '0.625rem',
                color: 'text.secondary',
                flexShrink: 0,
              })}
            >
              {needsInput && waitingSince !== null && now !== undefined
                ? formatWait(waitingSince, now)
                : state === 'idle' && idleSince !== null && now !== undefined
                  ? formatIdleFor(idleSince, now)
                  : history
                    ? `${formatWhen(history.endedAt)} · ${formatDuration(history.durationMs)}`
                    : ''}
            </Typography>
            {actions && (
              <Box
                className="session-row-actions"
                component="span"
                sx={{ display: 'none', alignItems: 'center', gap: 0.25, flexShrink: 0 }}
              >
                {actions}
              </Box>
            )}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
