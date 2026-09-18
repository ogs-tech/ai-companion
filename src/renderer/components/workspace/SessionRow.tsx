import { Box, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import type { SessionHistoryEntry } from '../../../shared/session-history.js';
import {
  describeCostSource,
  formatCostUsd,
  formatDuration,
  formatModel,
  formatWhen,
} from '../../lib/format-session-history.js';

export interface SessionRowProps {
  label: string;
  status: 'running' | 'exited';
  /** The transcript's reading of this conversation; absent while a just-spawned session has yet to write one. */
  history: SessionHistoryEntry | null;
  onOpen: () => void;
  /** Trailing hover actions (stop/delete), stopPropagation'd from the row itself. */
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
export function SessionRow({ label, status, history, onOpen, actions, testId }: SessionRowProps): React.ReactElement {
  const running = status === 'running';
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
        // A live session keeps the verde spine; an ended one drops it but
        // keeps full text contrast, because it is just as much a click target.
        borderLeft: `2px solid ${running ? theme.palette.success.main : 'transparent'}`,
        bgcolor: 'transparent',
        cursor: 'pointer',
        px: 1.25,
        py: 0.75,
        font: 'inherit',
        '&:hover': { bgcolor: theme.palette.action.hover },
        '&:hover .session-row-actions, &:focus-visible .session-row-actions': { opacity: 1 },
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      })}
    >
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, minWidth: 0 }}>
        <Typography
          component="span"
          noWrap
          sx={{ fontSize: '0.8125rem', flexGrow: 1, minWidth: 0, color: 'text.primary' }}
        >
          {label}
        </Typography>
        {costLabel === null ? (
          <Skeleton variant="text" width={34} sx={{ flexShrink: 0 }} data-testid={`${testId}-cost-pending`} />
        ) : (
          <Tooltip title={describeCostSource(history!.costSource)}>
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

      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, minWidth: 0, mt: 0.125 }}>
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
          {running && !history ? 'iniciando…' : formatModel(history?.model ?? null)}
        </Typography>
        <Typography
          component="span"
          noWrap
          sx={(theme) => ({
            fontFamily: theme.ogs.fonts.mono,
            fontSize: '0.625rem',
            color: 'text.secondary',
            flexShrink: 0,
          })}
        >
          {history ? `${formatWhen(history.endedAt)} · ${formatDuration(history.durationMs)}` : ''}
        </Typography>
      </Stack>

      {actions && (
        <Box
          className="session-row-actions"
          component="span"
          sx={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            opacity: 0,
            transition: 'opacity 120ms ease',
            bgcolor: 'background.paper',
            borderRadius: 1,
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
}
