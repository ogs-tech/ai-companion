import { Box, Stack, Tooltip, Typography } from '@mui/material';
import type { SessionHistoryDayTotal } from '../../../shared/session-history.js';
import { formatCostUsd, formatDayShort } from '../../lib/format-session-history.js';

interface SpendBarChartProps {
  perDay: readonly SessionHistoryDayTotal[];
  /** The day currently isolating the table, if any. */
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}

const CHART_HEIGHT = 96;
/** Beyond this, the axis labels stop fitting and only every other one is drawn. */
const DENSE_LABEL_THRESHOLD = 14;

/**
 * Spend per day, drawn by hand.
 *
 * No charting library: this is one bar per day with a tooltip, and pulling in
 * recharts or d3 for it would add a dependency heavier than the feature. Each
 * bar is a real `<button>` — clicking one isolates that day in the table
 * below, clicking it again releases it — so the chart is a control, not a
 * decoration.
 */
export function SpendBarChart({ perDay, selectedDay, onSelectDay }: SpendBarChartProps): React.ReactElement {
  const max = perDay.reduce((highest, day) => Math.max(highest, day.costUsd), 0);
  const dense = perDay.length > DENSE_LABEL_THRESHOLD;

  if (perDay.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="spend-chart-empty">
        Nenhum gasto no período.
      </Typography>
    );
  }

  return (
    <Stack
      direction="row"
      data-testid="spend-chart"
      role="group"
      aria-label="Gasto por dia"
      sx={{ alignItems: 'flex-end', gap: 0.5, height: CHART_HEIGHT + 18, overflowX: 'auto', pb: 0.5 }}
    >
      {perDay.map((day, index) => {
        const selected = selectedDay === day.date;
        // A day with real spend never renders as a zero-height sliver — the
        // floor keeps "small" distinguishable from "none".
        const height = max === 0 ? 0 : Math.max(2, Math.round((day.costUsd / max) * CHART_HEIGHT));
        return (
          <Stack key={day.date} sx={{ alignItems: 'center', gap: 0.25, minWidth: 18, flex: '1 0 18px' }}>
            <Tooltip
              title={`${formatDayShort(day.date)} · ${formatCostUsd(day.costUsd)} · ${day.sessionCount} ${
                day.sessionCount === 1 ? 'sessão' : 'sessões'
              }`}
            >
              <Box
                component="button"
                type="button"
                data-testid={`spend-bar-${day.date}`}
                aria-label={`${day.date}: ${formatCostUsd(day.costUsd)}`}
                aria-pressed={selected}
                onClick={() => onSelectDay(selected ? null : day.date)}
                sx={(theme) => ({
                  width: '100%',
                  height: CHART_HEIGHT,
                  display: 'flex',
                  alignItems: 'flex-end',
                  border: 0,
                  p: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                })}
              >
                <Box
                  sx={(theme) => ({
                    width: '100%',
                    height,
                    borderRadius: `${theme.ogs.radius.xs}px ${theme.ogs.radius.xs}px 0 0`,
                    bgcolor: selected ? theme.palette.primary.main : theme.palette.info.main,
                    opacity: selectedDay && !selected ? 0.35 : 1,
                    transition: 'opacity 120ms ease',
                  })}
                />
              </Box>
            </Tooltip>
            <Typography
              sx={(theme) => ({
                fontFamily: theme.ogs.fonts.mono,
                fontSize: '0.5625rem',
                color: 'text.secondary',
                visibility: dense && index % 2 === 1 ? 'hidden' : 'visible',
              })}
            >
              {formatDayShort(day.date)}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}
