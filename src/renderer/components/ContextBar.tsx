import { Box, Tooltip } from '@mui/material';
import { contextFraction, contextLevel, type SessionMetrics } from '../../shared/session-metrics.js';

const COLORS = { ok: 'text.disabled', warn: 'warning.main', danger: 'error.main' } as const;

/** Thin bar: amber over 70%, red over 90%. Hidden when the window is unknown. `estimated` prefixes "~". */
export function ContextBar({ metrics, estimated = false, testId }: { metrics: SessionMetrics | undefined; estimated?: boolean; testId?: string }): React.ReactElement | null {
  const fraction = contextFraction(metrics);
  if (fraction === null) return null;
  const level = contextLevel(fraction);
  const pct = Math.round(fraction * 100);
  const label = `Contexto ${estimated ? '~' : ''}${pct}%`;
  return (
    <Tooltip title={label}>
      <Box
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        data-testid={testId}
        data-level={level}
        sx={{ height: 3, width: 40, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden', flexShrink: 0 }}
      >
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: COLORS[level] }} />
      </Box>
    </Tooltip>
  );
}
